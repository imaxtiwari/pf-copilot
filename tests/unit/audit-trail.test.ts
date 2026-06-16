import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

// Set database path to ':memory:' before importing auditTrail
process.env.AUDIT_TRAIL_DB_PATH = ':memory:'

// Set mock database instance on globalThis to avoid hoisting TDZ ReferenceError
;(globalThis as any).dbInstance = null
let simulateWriteError = false

// Intercept better-sqlite3 using a mock class to properly support constructor instantiation
vi.mock('better-sqlite3', async (importOriginal) => {
  const ActualDatabase = ((await importOriginal()) as any).default
  
  return {
    default: class MockDatabase {
      pragma: any
      exec: any
      prepare: any
      
      constructor(path: string) {
        const realDb = new ActualDatabase(path)
        ;(globalThis as any).dbInstance = realDb
        
        this.pragma = (arg: string) => realDb.pragma(arg)
        this.exec = (arg: string) => realDb.exec(arg)
        this.prepare = (sql: string) => {
          const stmt = realDb.prepare(sql)
          return {
            run: (params: any) => {
              if (simulateWriteError && sql.includes('INSERT INTO audit_logs')) {
                throw new Error('Simulated SQLite write error')
              }
              return stmt.run(params)
            },
            all: (params: any) => stmt.all(params)
          }
        }
      }
    }
  }
})

describe('Immutable Audit Trail Unit Tests', () => {
  let auditTrail: any
  let AuditActionType: any

  beforeEach(async () => {
    vi.resetModules()
    ;(globalThis as any).dbInstance = null
    simulateWriteError = false

    const mod = await import('../../lib/audit/audit-trail')
    auditTrail = mod.auditTrail
    AuditActionType = mod.AuditActionType
  })

  it('should successfully write and query a single log event', () => {
    const runId = 'test-pipeline-run-id'
    const payload = { event: 'started', client: 'Alice' }
    
    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: 'SYSTEM',
      action_type: AuditActionType.PIPELINE_START,
      payload
    })

    const results = auditTrail.query({ pipeline_run_id: runId })
    expect(results).toHaveLength(1)
    expect(results[0].pipeline_run_id).toBe(runId)
    expect(results[0].agent_id).toBe('SYSTEM')
    expect(results[0].action_type).toBe(AuditActionType.PIPELINE_START)
    expect(JSON.parse(results[0].payload_json)).toEqual(payload)
  })

  it('should verify payload_hash matches SHA-256 of payload_json', () => {
    const payload = { action: 'vote', count: 3 }
    const payloadJson = JSON.stringify(payload)
    const expectedHash = createHash('sha256').update(payloadJson).digest('hex')

    const specificRunId = 'hash-test-run-id'
    auditTrail.log({
      pipeline_run_id: specificRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.COMMITTEE_VOTE_CAST,
      payload
    })

    const results = auditTrail.query({ pipeline_run_id: specificRunId })
    expect(results).toHaveLength(1)
    expect(results[0].payload_hash).toBe(expectedHash)
  })

  it('should catch failed write errors internally and NOT throw to caller', () => {
    simulateWriteError = true
    
    expect(() => {
      auditTrail.log({
        pipeline_run_id: 'fail-run-id',
        agent_id: 'SYSTEM',
        action_type: AuditActionType.PIPELINE_START,
        payload: { test: 'fail' }
      })
    }).not.toThrow()

    simulateWriteError = false
  })

  it('should prevent UPDATE attempts on audit_logs by throwing SQLite trigger abort error', () => {
    const db = (globalThis as any).dbInstance
    expect(db).not.toBeNull()
    
    expect(() => {
      db.exec("UPDATE audit_logs SET agent_id = 'HACKED'")
    }).toThrow(/AUDIT TRAIL IS IMMUTABLE/)
  })

  it('should return all events and correct breakdown for getRunSummary', () => {
    const summaryRunId = 'summary-run-id'
    
    auditTrail.log({
      pipeline_run_id: summaryRunId,
      agent_id: 'SYSTEM',
      action_type: AuditActionType.PIPELINE_START,
      payload: { msg: 'start' }
    })
    
    auditTrail.log({
      pipeline_run_id: summaryRunId,
      agent_id: 'ARIA',
      action_type: AuditActionType.ORACLE_FLAG_RAISED,
      payload: { msg: 'flag' }
    })

    const summary = auditTrail.getRunSummary(summaryRunId)
    expect(summary.pipeline_run_id).toBe(summaryRunId)
    expect(summary.total_events).toBe(2)
    expect(summary.event_breakdown[AuditActionType.PIPELINE_START]).toBe(1)
    expect(summary.event_breakdown[AuditActionType.ORACLE_FLAG_RAISED]).toBe(1)
    expect(summary.events).toHaveLength(2)
  })
})
