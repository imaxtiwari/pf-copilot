import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'
import { eq, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { deliberationMessages } from '@/db/schema'
import { DeliberationMessageSchema, DeliberationMessage, AgentId } from './message-schema'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { oracleMiddleware } from '../oracle/oracle'
import logger from '../logger'

// ─── Middleware Type ──────────────────────────────────────────────────────────

export type MiddlewareFn = (msg: DeliberationMessage) => Promise<DeliberationMessage>

// ─── Bound Room (pre-seeded with pipeline_run_id) ────────────────────────────

export interface BoundDeliberationRoom {
  publish(
    rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id'>
  ): Promise<DeliberationMessage>
  subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void
  getHistory(): Promise<DeliberationMessage[]>
}

// ─── Deliberation Room ────────────────────────────────────────────────────────

export class DeliberationRoom extends EventEmitter {
  private middlewares: MiddlewareFn[] = []
  private cache = new Map<string, DeliberationMessage[]>()

  constructor(private dbClient?: any) {
    super()
  }

  // Register a middleware (e.g. ORACLE interceptor in Step 5)
  addMiddleware(fn: MiddlewareFn): void {
    this.middlewares.push(fn)
  }

  // Publish a message through the full middleware → audit → broadcast pipeline
  async publish(
    rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation'>
  ): Promise<DeliberationMessage> {
    // 1. Auto-generate system fields
    const assembled: DeliberationMessage = {
      ...rawMsg,
      message_id: randomUUID(),
      timestamp: new Date().toISOString(),
      oracle_validation: { status: 'PENDING', flags: [] }
    }

    // 2. Validate against Zod schema — hard throw on invalid
    const parseResult = DeliberationMessageSchema.safeParse(assembled)
    if (!parseResult.success) {
      const err = parseResult.error
      logger.error({ err, assembled }, 'Deliberation message failed Zod validation')
      throw new ZodError(err.issues)
    }

    let message = parseResult.data

    // 3. Run middleware chain sequentially
    for (const middleware of this.middlewares) {
      try {
        message = await middleware(message)
      } catch (err) {
        logger.error({ err, message_id: message.message_id }, 'Middleware threw — aborting publish')
        throw err
      }
    }

    // Write-through caching
    const runId = message.pipeline_run_id
    if (!this.cache.has(runId)) {
      this.cache.set(runId, [])
    }
    this.cache.get(runId)!.push(message)

    // Best-effort database write
    if (this.dbClient) {
      try {
        await this.dbClient
          .insert(deliberationMessages)
          .values({
            messageId: message.message_id,
            pipelineRunId: message.pipeline_run_id,
            sender: message.sender,
            recipient: message.recipient,
            messageType: message.message_type,
            payload: message.payload,
            oracleValidation: message.oracle_validation,
            references: message.references,
            timestamp: new Date(message.timestamp),
          })
          .onConflictDoNothing()
      } catch (err) {
        logger.warn({ err, message_id: message.message_id }, 'Failed to persist deliberation message to PostgreSQL')
      }
    }

    // 4. Audit log the final post-middleware message as SENT
    auditTrail.log({
      pipeline_run_id: message.pipeline_run_id,
      agent_id: message.sender,
      action_type: AuditActionType.DELIBERATION_MESSAGE_SENT,
      payload: message as any
    })

    // 5. Broadcast to all matching subscribers
    this.emit('message', message)

    logger.info(
      { message_id: message.message_id, sender: message.sender, type: message.message_type, recipient: message.recipient },
      'Deliberation message published'
    )

    return message
  }

  // Subscribe an agent to messages addressed to them or broadcast to ALL
  subscribe(
    agentId: AgentId | 'ALL',
    handler: (msg: DeliberationMessage) => void
  ): () => void {
    const listener = (msg: DeliberationMessage) => {
      // Filter: deliver if recipient is this agent OR broadcast to ALL
      if (msg.recipient !== agentId && msg.recipient !== 'ALL') return

      // Audit log the delivery
      auditTrail.log({
        pipeline_run_id: msg.pipeline_run_id,
        agent_id: agentId === 'ALL' ? 'SYSTEM' : agentId,
        action_type: AuditActionType.DELIBERATION_MESSAGE_RECEIVED,
        payload: {
          message_id: msg.message_id,
          message_type: msg.message_type,
          sender: msg.sender
        }
      })

      handler(msg)
    }

    this.on('message', listener)

    // Return unsubscribe function
    return () => {
      this.off('message', listener)
    }
  }

  // Return full deliberation history for a pipeline run
  async getHistory(pipeline_run_id: string): Promise<DeliberationMessage[]> {
    if (this.dbClient) {
      try {
        const rows = await this.dbClient
          .select()
          .from(deliberationMessages)
          .where(eq(deliberationMessages.pipelineRunId, pipeline_run_id))
          .orderBy(asc(deliberationMessages.timestamp))

        return rows.map((row: any) => ({
          message_id: row.messageId,
          pipeline_run_id: row.pipelineRunId,
          timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
          sender: row.sender,
          message_type: row.messageType,
          recipient: row.recipient,
          payload: row.payload,
          oracle_validation: row.oracleValidation,
          references: row.references || []
        })) as DeliberationMessage[]
      } catch (err) {
        logger.warn({ err, pipeline_run_id }, 'Failed to read deliberation history from DB, falling back to cache/auditTrail')
      }
    }

    // Fallback: Check local cache first
    const cached = this.cache.get(pipeline_run_id)
    if (cached && cached.length > 0) {
      return cached
    }

    // Fallback to legacy audit trail query
    const logs = auditTrail.query({
      pipeline_run_id,
      action_type: AuditActionType.DELIBERATION_MESSAGE_SENT
    })

    return logs.reduce<DeliberationMessage[]>((acc, log) => {
      try {
        const payload = JSON.parse(log.payload_json) as { message_id?: string }
        acc.push(payload as unknown as DeliberationMessage)
      } catch {
        logger.warn({ log_id: log.log_id }, 'Could not parse deliberation log payload')
      }
      return acc
    }, [])
  }

  // Return a version of the room pre-bound to a specific pipeline_run_id
  createForRun(pipeline_run_id: string): BoundDeliberationRoom {
    const room = this

    return {
      publish(
        rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id'>
      ): Promise<DeliberationMessage> {
        return room.publish({ ...rawMsg, pipeline_run_id })
      },

      subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void {
        return room.subscribe(agentId, handler)
      },

      getHistory(): Promise<DeliberationMessage[]> {
        return room.getHistory(pipeline_run_id)
      }
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const deliberationRoom = new DeliberationRoom(db)

// Increase max listeners to accommodate all 7 agents subscribing
deliberationRoom.setMaxListeners(20)

// ORACLE is ALWAYS first — registered before any agent middleware
deliberationRoom.addMiddleware(oracleMiddleware)

