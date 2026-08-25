import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'
import { eq, asc, and } from 'drizzle-orm'
import type { DbClient } from '@/lib/db'
import { deliberationMessages } from '@/db/schema'
import { DeliberationMessageSchema, DeliberationMessage, AgentId } from './message-schema'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'

// ─── Middleware Type ──────────────────────────────────────────────────────────

export type MiddlewareFn = (msg: DeliberationMessage) => Promise<DeliberationMessage>

// ─── Bound Room (pre-seeded with pipeline_run_id) ────────────────────────────

type PublishInput = Omit<
  DeliberationMessage,
  'message_id' | 'timestamp' | 'oracle_validation' | 'pipeline_run_id' | 'depth' | 'reply_to_message_id' | 'thread_root_id'
> & {
  reply_to_message_id?: string | null
  thread_root_id?: string | null
  depth?: number
  user_id?: string
}

export interface BoundDeliberationRoom {
  publish(rawMsg: PublishInput, replyTo?: string): Promise<DeliberationMessage>
  send(message: PublishInput, replyTo?: string): Promise<string>
  subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void
  getHistory(): Promise<DeliberationMessage[]>
  receiveThread(rootMessageId: string): Promise<DeliberationMessage[]>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToMessage(row: typeof deliberationMessages.$inferSelect): DeliberationMessage {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  return {
    message_id: row.messageId,
    pipeline_run_id: row.pipelineRunId,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    sender: row.sender as AgentId,
    message_type: row.messageType as DeliberationMessage['message_type'],
    recipient: (meta.recipient ?? 'ALL') as DeliberationMessage['recipient'],
    content: row.content,
    payload: (meta.payload ?? {}) as Record<string, unknown>,
    oracle_validation: (meta.oracle_validation ?? { status: 'PENDING', flags: [] }) as DeliberationMessage['oracle_validation'],
    references: (meta.references ?? []) as string[],
    reply_to_message_id: row.replyToMessageId,
    thread_root_id: row.threadRootId,
    depth: (meta.depth ?? 0) as number,
  }
}

function messageToMetadata(msg: DeliberationMessage): Record<string, unknown> {
  return {
    recipient: msg.recipient,
    payload: msg.payload,
    oracle_validation: msg.oracle_validation,
    references: msg.references,
    depth: msg.depth ?? 0,
  }
}

// ─── Deliberation Room ────────────────────────────────────────────────────────

export class DeliberationRoom extends EventEmitter {
  private middlewares: MiddlewareFn[] = []
  private cache = new Map<string, DeliberationMessage[]>()
  private pipelineRunId?: string

  constructor(private dbClient?: DbClient, pipelineRunId?: string) {
    super()
    this.pipelineRunId = pipelineRunId
  }

  bind(pipelineRunId: string): BoundDeliberationRoom {
    return new DeliberationRoom(this.dbClient, pipelineRunId) as unknown as BoundDeliberationRoom
  }

  // Register a middleware (e.g. ORACLE interceptor in Step 5)
  addMiddleware(fn: MiddlewareFn): void {
    this.middlewares.push(fn)
  }

  // Helper to fetch message by ID (checks cache, then DB)
  async getMessageById(messageId: string): Promise<DeliberationMessage | null> {
    // 1. Search cache
    for (const messages of this.cache.values()) {
      const found = messages.find((m) => m.message_id === messageId)
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
        if (row) return rowToMessage(row)
      } catch (err) {
        logger.warn({ err, messageId }, 'Failed to query message by ID from DB')
      }
    }
    return null
  }

  // Resolve thread root for a given parent message ID
  async resolveThreadRoot(parentId: string): Promise<string> {
    if (!this.dbClient) return parentId
    try {
      const [parent] = await this.dbClient
        .select({ threadRootId: deliberationMessages.threadRootId })
        .from(deliberationMessages)
        .where(eq(deliberationMessages.messageId, parentId))
        .limit(1)
      return parent?.threadRootId ?? parentId
    } catch (e) {
      return parentId
    }
  }

  async getParentDepth(parentId: string): Promise<number> {
    if (!this.dbClient) return 0
    try {
      const [parent] = await this.dbClient
        .select({ metadata: deliberationMessages.metadata })
        .from(deliberationMessages)
        .where(eq(deliberationMessages.messageId, parentId))
        .limit(1)
      const meta = (parent?.metadata ?? {}) as Record<string, unknown>
      return (meta.depth as number) ?? 0
    } catch (e) {
      return 0
    }
  }

  // Publish a message through the full middleware → audit → broadcast pipeline
  async publish(rawMsg: PublishInput, replyTo?: string): Promise<DeliberationMessage> {
    const messageId = (rawMsg as any).message_id || randomUUID()
    const pipelineRunId = this.pipelineRunId || (rawMsg as any).pipeline_run_id || 'unknown'

    let replyToMessageId: string | null = null
    let threadRootId = messageId
    let depth = 0

    if (replyTo) {
      // Verify parent exists before linking
      let parentExists = false
      if (this.dbClient) {
        try {
          const [parent] = await this.dbClient
            .select({ id: deliberationMessages.messageId })
            .from(deliberationMessages)
            .where(eq(deliberationMessages.messageId, replyTo))
            .limit(1)
          parentExists = !!parent
        } catch (e) {
          logger.warn({ e, replyTo }, 'Failed to query parent existence')
        }
      } else {
        parentExists = !!(await this.getMessageById(replyTo))
      }

      if (!parentExists) {
        auditTrail.log({
          pipeline_run_id: pipelineRunId,
          user_id: (rawMsg as any).user_id,
          agent_id: 'SYSTEM',
          action_type: AuditActionType.DELIBERATION_MESSAGE_SENT,
          payload: {
            type: 'THREADING_FALLBACK',
            attemptedReplyTo: replyTo,
            reason: 'parent_not_found',
            messageType: (rawMsg as any).message_type,
          },
        })
        replyToMessageId = null
        threadRootId = messageId
        depth = 0
      } else {
        replyToMessageId = replyTo
        threadRootId = await this.resolveThreadRoot(replyTo)
        depth = (await this.getParentDepth(replyTo)) + 1
      }
    }

    // Auto-generate system fields
    const assembled: DeliberationMessage = {
      ...rawMsg,
      message_id: messageId,
      timestamp: (rawMsg as any).timestamp || new Date().toISOString(),
      oracle_validation: (rawMsg as any).oracle_validation || { status: 'PENDING', flags: [] },
      reply_to_message_id: replyToMessageId,
      thread_root_id: threadRootId,
      depth,
    } as DeliberationMessage

    // Validate against Zod schema — hard throw on invalid
    const parseResult = DeliberationMessageSchema.safeParse(assembled)
    if (!parseResult.success) {
      const err = parseResult.error
      logger.error({ err, assembled }, 'Deliberation message failed Zod validation')
      throw new ZodError(err.issues)
    }

    let message = parseResult.data

    // Run middleware chain sequentially
    for (const fn of this.middlewares) {
      try {
        message = await fn(message)
      } catch (err) {
        logger.error({ err, messageId }, 'Deliberation middleware failed')
        throw err
      }
    }

    // Persist to Postgres with idempotent insertion
    if (this.dbClient) {
      try {
        await this.dbClient
          .insert(deliberationMessages)
          .values({
            messageId: message.message_id,
            pipelineRunId: message.pipeline_run_id,
            replyToMessageId: message.reply_to_message_id,
            threadRootId: message.thread_root_id,
            sender: message.sender,
            messageType: message.message_type,
            content: message.content,
            metadata: messageToMetadata(message),
          })
          .onConflictDoNothing({ target: deliberationMessages.messageId })
      } catch (err) {
        logger.warn({ err, messageId }, 'Failed to insert deliberation message; broadcasting in-memory only')
      }
    }

    // Audit trail
    auditTrail.log({
      pipeline_run_id: message.pipeline_run_id,
      user_id: (rawMsg as any).user_id,
      agent_id: message.sender,
      action_type: AuditActionType.DELIBERATION_MESSAGE_SENT,
      payload: {
        message_type: message.message_type,
        recipient: message.recipient,
        thread_root_id: message.thread_root_id,
        depth: message.depth,
      },
    })

    // Broadcast and cache
    this.emit('message', message)
    this.emit(`message:${message.sender}`, message)
    if (!this.cache.has(message.pipeline_run_id)) {
      this.cache.set(message.pipeline_run_id, [])
    }
    this.cache.get(message.pipeline_run_id)!.push(message)

    return message
  }

  // Convenience method that returns just the message_id
  async send(message: PublishInput, replyTo?: string): Promise<string> {
    const published = await this.publish(message, replyTo)
    return published.message_id
  }

  // Subscribe to messages for a specific agent or ALL
  subscribe(agentId: AgentId | 'ALL', handler: (msg: DeliberationMessage) => void): () => void {
    const eventName = agentId === 'ALL' ? 'message' : `message:${agentId}`
    this.on(eventName, handler)
    return () => this.off(eventName, handler)
  }

  // Load full history for a pipeline run
  async getHistory(pipelineRunId?: string): Promise<DeliberationMessage[]> {
    const runId = pipelineRunId ?? this.pipelineRunId
    if (!this.dbClient) {
      if (!runId) return Array.from(this.cache.values()).flat()
      return this.cache.get(runId) ?? []
    }

    try {
      const rows = await this.dbClient
        .select()
        .from(deliberationMessages)
        .where(runId ? eq(deliberationMessages.pipelineRunId, runId) : undefined)
        .orderBy(asc(deliberationMessages.timestamp))
      return rows.map(rowToMessage)
    } catch (err) {
      logger.error({ err, pipelineRunId: runId }, 'Failed to load deliberation history')
      return runId ? this.cache.get(runId) ?? [] : []
    }
  }

  // Load a thread by root message ID
  async receiveThread(rootMessageId: string): Promise<DeliberationMessage[]> {
    if (!this.dbClient) {
      for (const messages of this.cache.values()) {
        const thread = messages.filter(
          (m) => m.thread_root_id === rootMessageId || m.message_id === rootMessageId,
        )
        if (thread.length) return thread
      }
      return []
    }

    try {
      const rows = await this.dbClient
        .select()
        .from(deliberationMessages)
        .where(
          and(
            eq(deliberationMessages.threadRootId, rootMessageId),
          ),
        )
        .orderBy(asc(deliberationMessages.timestamp))
      return rows.map(rowToMessage)
    } catch (err) {
      logger.error({ err, rootMessageId }, 'Failed to load deliberation thread')
      return []
    }
  }
}
