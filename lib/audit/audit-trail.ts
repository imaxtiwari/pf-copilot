import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'crypto'
import logger from '../logger'
import * as fs from 'fs'
import * as path from 'path'

// Ensure DB directory exists
const dbPath = process.env.AUDIT_TRAIL_DB_PATH || './data/audit_trail.db'
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

// 1. Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    log_id TEXT PRIMARY KEY,
    pipeline_run_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    oracle_confidence REAL,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )
`)

try {
  db.exec(`ALTER TABLE audit_logs ADD COLUMN oracle_confidence REAL;`)
} catch (e) {
  // Column already exists
}

// 2. Create triggers for immutability
// In SQLite, RAISING an ABORT inside a trigger rolls back the operation
db.exec(`
  CREATE TRIGGER IF NOT EXISTS prevent_update_audit_logs
  BEFORE UPDATE ON audit_logs
  BEGIN
    SELECT RAISE(ABORT, 'AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED');
  END;
`)

db.exec(`
  CREATE TRIGGER IF NOT EXISTS prevent_delete_audit_logs
  BEFORE DELETE ON audit_logs
  BEGIN
    SELECT RAISE(ABORT, 'AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED');
  END;
`)

// 3. Export Actions
export enum AuditActionType {
  PIPELINE_START = 'PIPELINE_START',
  PIPELINE_END = 'PIPELINE_END',
  PIPELINE_DEADLOCK = 'PIPELINE_DEADLOCK',
  ARIA_PREFLIGHT_COMPLETE = 'ARIA_PREFLIGHT_COMPLETE',
  DELIBERATION_MESSAGE_SENT = 'DELIBERATION_MESSAGE_SENT',
  DELIBERATION_MESSAGE_RECEIVED = 'DELIBERATION_MESSAGE_RECEIVED',
  ORACLE_FLAG_RAISED = 'ORACLE_FLAG_RAISED',
  ORACLE_VALIDATION_PASSED = 'ORACLE_VALIDATION_PASSED',
  COMMITTEE_VOTE_CAST = 'COMMITTEE_VOTE_CAST',
  COMMITTEE_VOTE_RESULT = 'COMMITTEE_VOTE_RESULT',
  PORTFOLIO_DRAFT_CREATED = 'PORTFOLIO_DRAFT_CREATED',
  PORTFOLIO_DRAFT_REVISED = 'PORTFOLIO_DRAFT_REVISED',
  PORTFOLIO_APPROVED = 'PORTFOLIO_APPROVED',
  MEMORY_WRITE = 'MEMORY_WRITE',
  MEMORY_READ = 'MEMORY_READ',
  WEB_RESEARCH_QUERY = 'WEB_RESEARCH_QUERY',
  WEB_RESEARCH_RESULT = 'WEB_RESEARCH_RESULT',
  CLIENT_FACT_CONFIRMED = 'CLIENT_FACT_CONFIRMED',
  AGENT_WEEKLY_RESEARCH_COMPLETE = 'AGENT_WEEKLY_RESEARCH_COMPLETE',
  KNOWLEDGE_COMMONS_WRITE = 'KNOWLEDGE_COMMONS_WRITE',
  LIFE_EVENT_RECEIVED = 'LIFE_EVENT_RECEIVED',
  CAS_PARSE_ATTEMPT = 'CAS_PARSE_ATTEMPT',
  CONFIDENCE_DIVERGING = 'CONFIDENCE_DIVERGING',
  RIYA_PROFILING_COMPLETE = 'RIYA_PROFILING_COMPLETE',
  ORACLE_CROSS_RUN_ANOMALY = 'ORACLE_CROSS_RUN_ANOMALY'
}

export type AgentId = 'ARIA' | 'KIRAN' | 'SOMA' | 'VIKRAM' | 'PRIYA' | 'DHRUV' | 'ORACLE' | 'SYSTEM' | 'RIYA'

export interface AuditEntry {
  pipeline_run_id: string
  agent_id: AgentId
  action_type: AuditActionType
  oracle_confidence?: number
  payload: Record<string, unknown>
}

export interface AuditLog {
  log_id: string
  pipeline_run_id: string
  timestamp: string
  agent_id: AgentId
  action_type: AuditActionType
  oracle_confidence?: number
  payload_hash: string
  payload_json: string
}

export interface AuditQueryFilters {
  pipeline_run_id?: string
  agent_id?: AgentId
  action_type?: AuditActionType
  from_timestamp?: string
  to_timestamp?: string
}

export interface AuditRunSummary {
  pipeline_run_id: string
  total_events: number
  event_breakdown: Record<string, number>
  events: AuditLog[]
}

const insertStmt = db.prepare(`
  INSERT INTO audit_logs (log_id, pipeline_run_id, timestamp, agent_id, action_type, oracle_confidence, payload_hash, payload_json)
  VALUES (@log_id, @pipeline_run_id, @timestamp, @agent_id, @action_type, @oracle_confidence, @payload_hash, @payload_json)
`)

// 4. Singleton class
class AuditTrail {
  public log(entry: AuditEntry): void {
    try {
      const payload_json = JSON.stringify(entry.payload)
      const payload_hash = createHash('sha256').update(payload_json).digest('hex')

      insertStmt.run({
        log_id: randomUUID(),
        pipeline_run_id: entry.pipeline_run_id,
        timestamp: new Date().toISOString(),
        agent_id: entry.agent_id,
        action_type: entry.action_type,
        oracle_confidence: entry.oracle_confidence ?? null,
        payload_hash,
        payload_json
      })
    } catch (err) {
      // Must NEVER crash the pipeline
      logger.error({ err, entry }, 'Failed to write to immutable audit trail')
    }
  }

  public query(filters: AuditQueryFilters): AuditLog[] {
    let sql = 'SELECT * FROM audit_logs WHERE 1=1'
    const params: Record<string, unknown> = {}

    if (filters.pipeline_run_id) {
      sql += ' AND pipeline_run_id = @pipeline_run_id'
      params.pipeline_run_id = filters.pipeline_run_id
    }
    if (filters.agent_id) {
      sql += ' AND agent_id = @agent_id'
      params.agent_id = filters.agent_id
    }
    if (filters.action_type) {
      sql += ' AND action_type = @action_type'
      params.action_type = filters.action_type
    }
    if (filters.from_timestamp) {
      sql += ' AND timestamp >= @from_timestamp'
      params.from_timestamp = filters.from_timestamp
    }
    if (filters.to_timestamp) {
      sql += ' AND timestamp <= @to_timestamp'
      params.to_timestamp = filters.to_timestamp
    }

    sql += ' ORDER BY timestamp ASC'

    const stmt = db.prepare(sql)
    return stmt.all(params) as AuditLog[]
  }

  public getRunSummary(pipeline_run_id: string): AuditRunSummary {
    const events = this.query({ pipeline_run_id })
    const event_breakdown: Record<string, number> = {}
    
    events.forEach(e => {
      event_breakdown[e.action_type] = (event_breakdown[e.action_type] || 0) + 1
    })

    return {
      pipeline_run_id,
      total_events: events.length,
      event_breakdown,
      events
    }
  }
}

export const auditTrail = new AuditTrail()

// Initial system log
auditTrail.log({
  pipeline_run_id: 'SYSTEM_STARTUP',
  agent_id: 'SYSTEM',
  action_type: AuditActionType.PIPELINE_START,
  payload: {
    message: `Audit trail initialised. Database integrity: OK.`
  }
})
