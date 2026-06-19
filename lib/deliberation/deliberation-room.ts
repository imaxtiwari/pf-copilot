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
    rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
      reply_to_message_id?: string | null
      thread_root_id?: string | null
      depth?: number
    },
    replyTo?: string
  ): Promise<DeliberationMessage>
  send(
    message: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
      reply_to_message_id?: string | null
      thread_root_id?: string | null
      depth?: number
    },
    replyTo?: string
  ): Promise<string>
  subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void
  getHistory(): Promise<DeliberationMessage[]>
  receiveThread(rootMessageId: string): Promise<DeliberationMessage[]>
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

  // Helper to fetch message by ID (checks cache, then DB)
  async getMessageById(messageId: string): Promise<DeliberationMessage | null> {
    // 1. Search cache
    for (const messages of this.cache.values()) {
      const found = messages.find(m => m.message_id === messageId)
      if (found) return found
    }

    // 2. Search database
    if (this.dbClient) {
      try {
        const [row] = await this.dbClient
          .select()
          .from(deliberationMessages)
          .where(eq(deliberationMessages.messageId, messageId))
          .limit(1)
        if (row) {
          return {
            message_id: row.messageId,
            pipeline_run_id: row.pipelineRunId,
            timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
            sender: row.sender,
            message_type: row.messageType,
            recipient: row.recipient,
            payload: row.payload,
            oracle_validation: row.oracleValidation,
            references: row.references || [],
            reply_to_message_id: row.replyToMessageId,
            thread_root_id: row.threadRootId,
            depth: row.depth ?? 0
          } as DeliberationMessage
        }
      } catch (err) {
        logger.warn({ err, messageId }, 'Failed to query message by ID from DB')
      }
    }
    return null
  }

  // Publish a message through the full middleware → audit → broadcast pipeline
  async publish(
    rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
      reply_to_message_id?: string | null
      thread_root_id?: string | null
      depth?: number
    },
    replyTo?: string
  ): Promise<DeliberationMessage> {
    const messageId = (rawMsg as any).message_id || randomUUID()
    
    let replyToMessageId: string | null = null
    let threadRootId = messageId
    let depth = 0

    if (replyTo) {
      const parent = await this.getMessageById(replyTo)
      if (parent) {
        replyToMessageId = parent.message_id
        threadRootId = parent.thread_root_id || parent.message_id
        depth = (parent.depth ?? 0) + 1
      } else {
        replyToMessageId = replyTo
        threadRootId = replyTo
        depth = 1
      }
    }

    // 1. Auto-generate system fields
    const assembled: DeliberationMessage = {
      ...rawMsg,
      message_id: messageId,
      timestamp: (rawMsg as any).timestamp || new Date().toISOString(),
      oracle_validation: (rawMsg as any).oracle_validation || { status: 'PENDING', flags: [] },
      reply_to_message_id: replyToMessageId,
      thread_root_id: threadRootId,
      depth
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
            replyToMessageId: message.reply_to_message_id,
            threadRootId: message.thread_root_id,
            depth: message.depth
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

  // Send method signature matching user request
  async send(
    message: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
      reply_to_message_id?: string | null
      thread_root_id?: string | null
      depth?: number
    },
    replyTo?: string
  ): Promise<string> {
    const published = await this.publish(message, replyTo)
    return published.message_id
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
          references: row.references || [],
          reply_to_message_id: row.replyToMessageId,
          thread_root_id: row.threadRootId,
          depth: row.depth ?? 0
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

  // Return all messages in a thread, ordered by depth then timestamp
  async receiveThread(rootMessageId: string): Promise<DeliberationMessage[]> {
    if (this.dbClient) {
      try {
        const rows = await this.dbClient
          .select()
          .from(deliberationMessages)
          .where(eq(deliberationMessages.threadRootId, rootMessageId))
          .orderBy(asc(deliberationMessages.depth), asc(deliberationMessages.timestamp))

        return rows.map((row: any) => ({
          message_id: row.messageId,
          pipeline_run_id: row.pipelineRunId,
          timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
          sender: row.sender,
          message_type: row.messageType,
          recipient: row.recipient,
          payload: row.payload,
          oracle_validation: row.oracleValidation,
          references: row.references || [],
          reply_to_message_id: row.replyToMessageId,
          thread_root_id: row.threadRootId,
          depth: row.depth ?? 0
        })) as DeliberationMessage[]
      } catch (err) {
        logger.warn({ err, rootMessageId }, 'Failed to read thread history from DB, falling back to cache')
      }
    }

    // Fallback: Search local cache
    const threadMessages: DeliberationMessage[] = []
    for (const messages of this.cache.values()) {
      for (const msg of messages) {
        if (msg.thread_root_id === rootMessageId) {
          threadMessages.push(msg)
        }
      }
    }

    // Sort by depth then timestamp
    return threadMessages.sort((a, b) => {
      if ((a.depth ?? 0) !== (b.depth ?? 0)) {
        return (a.depth ?? 0) - (b.depth ?? 0)
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    })
  }

  // Return a version of the room pre-bound to a specific pipeline_run_id
  createForRun(pipeline_run_id: string): BoundDeliberationRoom {
    const room = this

    return {
      publish(
        rawMsg: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
          reply_to_message_id?: string | null
          thread_root_id?: string | null
          depth?: number
        },
        replyTo?: string
      ): Promise<DeliberationMessage> {
        return room.publish({ ...rawMsg, pipeline_run_id } as any, replyTo)
      },

      send(
        message: Omit<DeliberationMessage, 'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id' | 'depth' | 'reply_to_message_id' | 'thread_root_id'> & {
          reply_to_message_id?: string | null
          thread_root_id?: string | null
          depth?: number
        },
        replyTo?: string
      ): Promise<string> {
        return room.send({ ...message, pipeline_run_id } as any, replyTo)
      },

      subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void {
        return room.subscribe(agentId, handler)
      },

      getHistory(): Promise<DeliberationMessage[]> {
        return room.getHistory(pipeline_run_id)
      },

      receiveThread(rootMessageId: string): Promise<DeliberationMessage[]> {
        return room.receiveThread(rootMessageId)
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

