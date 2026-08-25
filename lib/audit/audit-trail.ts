import { randomUUID, createHash } from 'crypto'
import { eq, and, gte, lte } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm/sql'
import { db } from '@/lib/db'
import { pipelineAuditLogs } from '@/db/schema'
import logger from '@/lib/logger'

// ─── Actions ──────────────────────────────────────────────────────────────────

export enum AuditActionType {
  PIPELINE_START = 'PIPELINE_START',
  PIPELINE_END = 'PIPELINE_END',
  PIPELINE_STAGE_TRANSITION = 'PIPELINE_STAGE_TRANSITION',
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
  ORACLE_CROSS_RUN_ANOMALY = 'ORACLE_CROSS_RUN_ANOMALY',
  ARIA_MINOR_ACCUMULATION_REJECT = 'ARIA_MINOR_ACCUMULATION_REJECT',
  DEADLOCK_STAGE_CORRECTION = 'DEADLOCK_STAGE_CORRECTION',
  FORCE_STAGE_SET = 'FORCE_STAGE_SET',
}

export type AgentId = 'ARIA' | 'KIRAN' | 'SOMA' | 'VIKRAM' | 'PRIYA' | 'DHRUV' | 'ORACLE' | 'SYSTEM' | 'RIYA'

export interface AuditEntry {
  pipeline_run_id: string
  user_id?: string
  agent_id: AgentId
  action_type: AuditActionType
  oracle_confidence?: number
  payload: Record<string, unknown>
}

export interface AuditLog {
  log_id: string
  pipeline_run_id: string
  user_id: string
  timestamp: string
  agent_id: AgentId
  action_type: AuditActionType
  oracle_confidence?: number
  payload_hash: string
  payload_json: string
}

export interface AuditQueryFilters {
  pipeline_run_id?: string
  user_id?: string
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

// ─── Singleton ─────────────────────────────────────────────────────────────────

class AuditTrail {
  /**
   * Write an immutable audit entry to PostgreSQL.
   * Failures are logged but never thrown, so the pipeline cannot be crashed by audit pressure.
   */
  public log(entry: AuditEntry): void {
    // Fire-and-forget: callers should not await logging.
    void this.write(entry).catch((err) => {
      logger.error({ err, entry }, 'Failed to write to immutable audit trail')
    })
  }

  private async write(entry: AuditEntry): Promise<void> {
    const payload_json = JSON.stringify(entry.payload)
    const payload_hash = createHash('sha256').update(payload_json).digest('hex')

    await db.insert(pipelineAuditLogs).values({
      logId: randomUUID(),
      pipelineRunId: entry.pipeline_run_id,
      userId: entry.user_id ?? '00000000-0000-0000-0000-000000000000',
      agentId: entry.agent_id,
      actionType: entry.action_type,
      oracleConfidence: entry.oracle_confidence ?? null,
      payloadHash: payload_hash,
      payloadJson: payload_json,
    })
  }

  public async query(filters: AuditQueryFilters): Promise<AuditLog[]> {
    const conditions: SQL<unknown>[] = []

    if (filters.pipeline_run_id) {
      conditions.push(eq(pipelineAuditLogs.pipelineRunId, filters.pipeline_run_id))
    }
    if (filters.user_id) {
      conditions.push(eq(pipelineAuditLogs.userId, filters.user_id))
    }
    if (filters.agent_id) {
      conditions.push(eq(pipelineAuditLogs.agentId, filters.agent_id))
    }
    if (filters.action_type) {
      conditions.push(eq(pipelineAuditLogs.actionType, filters.action_type))
    }
    if (filters.from_timestamp) {
      conditions.push(gte(pipelineAuditLogs.timestamp, new Date(filters.from_timestamp)))
    }
    if (filters.to_timestamp) {
      conditions.push(lte(pipelineAuditLogs.timestamp, new Date(filters.to_timestamp)))
    }

    const rows = await db
      .select()
      .from(pipelineAuditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(pipelineAuditLogs.timestamp)

    return rows.map((r) => this.rowToLog(r))
  }

  public async getRunSummary(pipeline_run_id: string): Promise<AuditRunSummary> {
    const events = await this.query({ pipeline_run_id })
    const event_breakdown: Record<string, number> = {}

    events.forEach((e) => {
      event_breakdown[e.action_type] = (event_breakdown[e.action_type] ?? 0) + 1
    })

    return {
      pipeline_run_id,
      total_events: events.length,
      event_breakdown,
      events,
    }
  }

  private rowToLog(row: typeof pipelineAuditLogs.$inferSelect): AuditLog {
    return {
      log_id: row.logId,
      pipeline_run_id: row.pipelineRunId,
      user_id: row.userId,
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
      agent_id: row.agentId as AgentId,
      action_type: row.actionType as AuditActionType,
      oracle_confidence: row.oracleConfidence ?? undefined,
      payload_hash: row.payloadHash,
      payload_json: row.payloadJson,
    }
  }

  /** Application-layer guard: updates and deletes are rejected because the DB triggers enforce immutability. */
  public async update(): Promise<never> {
    throw new Error('AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED')
  }

  public async delete(): Promise<never> {
    throw new Error('AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED')
  }
}

export const auditTrail = new AuditTrail()
