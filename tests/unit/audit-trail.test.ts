// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import * as schema from '@/db/schema'
import { createTestPool, createTestDb, type TestDb } from './test-db'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'

describe('PostgreSQL audit trail', () => {
  let pool: Pool
  let db: TestDb
  let userId: string
  let runId: string

  beforeAll(async () => {
    pool = createTestPool()
    db = createTestDb(pool)

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id })
    userId = user.id

    const [run] = await db
      .insert(schema.pipelineRuns)
      .values({ clientId: userId, status: 'PENDING', stage: 'INTAKE' })
      .returning({ runId: schema.pipelineRuns.runId })
    runId = run.runId
  })

  afterAll(async () => {
    // cleanup intentionally skipped — local test DB accumulates rows but UUIDs keep assertions stable
    await pool.end()
  })

  it('writes and queries a single log event', async () => {
    auditTrail.log({
      pipeline_run_id: runId,
      user_id: userId,
      agent_id: 'SYSTEM',
      action_type: AuditActionType.PIPELINE_START,
      payload: { event: 'started', client: 'Alice' },
    })

    await new Promise((resolve) => setTimeout(resolve, 200))

    const results = await auditTrail.query({ pipeline_run_id: runId })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].pipeline_run_id).toBe(runId)
    expect(results[0].agent_id).toBe('SYSTEM')
    expect(results[0].action_type).toBe(AuditActionType.PIPELINE_START)
    expect(JSON.parse(results[0].payload_json)).toEqual({ event: 'started', client: 'Alice' })
  })

  it('verifies payload_hash matches SHA-256 of payload_json', async () => {
    const payload = { action: 'vote', count: 3 }
    auditTrail.log({
      pipeline_run_id: runId,
      user_id: userId,
      agent_id: 'ORACLE',
      action_type: AuditActionType.COMMITTEE_VOTE_CAST,
      payload,
    })

    await new Promise((resolve) => setTimeout(resolve, 200))

    const results = await auditTrail.query({ pipeline_run_id: runId, agent_id: 'ORACLE' })
    const entry = results.find((r) => r.action_type === AuditActionType.COMMITTEE_VOTE_CAST)
    expect(entry).toBeDefined()
    const crypto = await import('crypto')
    const expectedHash = crypto.createHash('sha256').update(entry!.payload_json).digest('hex')
    expect(entry!.payload_hash).toBe(expectedHash)
  })

  it('rejects application-layer update and delete attempts', async () => {
    await expect(auditTrail.update()).rejects.toThrow('AUDIT TRAIL IS IMMUTABLE')
    await expect(auditTrail.delete()).rejects.toThrow('AUDIT TRAIL IS IMMUTABLE')
  })

  it('produces a run summary', async () => {
    const summary = await auditTrail.getRunSummary(runId)
    expect(summary.pipeline_run_id).toBe(runId)
    expect(summary.total_events).toBeGreaterThanOrEqual(1)
    expect(summary.events.length).toBe(summary.total_events)
    expect(summary.event_breakdown[AuditActionType.PIPELINE_START]).toBeGreaterThanOrEqual(1)
  })
})
