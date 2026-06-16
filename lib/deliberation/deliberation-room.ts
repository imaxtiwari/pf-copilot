import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'
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
  getHistory(): DeliberationMessage[]
}

// ─── Deliberation Room ────────────────────────────────────────────────────────

export class DeliberationRoom extends EventEmitter {
  private middlewares: MiddlewareFn[] = []

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

  // Return full deliberation history for a pipeline run (read from audit trail)
  getHistory(pipeline_run_id: string): DeliberationMessage[] {
    const logs = auditTrail.query({
      pipeline_run_id,
      action_type: AuditActionType.DELIBERATION_MESSAGE_SENT
    })

    return logs.reduce<DeliberationMessage[]>((acc, log) => {
      try {
        const payload = JSON.parse(log.payload_json) as { message_id?: string }
        // The full message was captured in audit payload — reconstruct if full msg stored
        // Here we return what we have from the audit record
        // For full message replay, agents should store full payload; this returns metadata
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

      getHistory(): DeliberationMessage[] {
        return room.getHistory(pipeline_run_id)
      }
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const deliberationRoom = new DeliberationRoom()

// Increase max listeners to accommodate all 7 agents subscribing
deliberationRoom.setMaxListeners(20)

// ORACLE is ALWAYS first — registered before any agent middleware
deliberationRoom.addMiddleware(oracleMiddleware)
