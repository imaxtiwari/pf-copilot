import { eq, sql, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { knowledgeCommons } from '@/db/schema'
import { getEmbedding } from '@/lib/azure-openai'
import { auditTrail, AuditActionType, AgentId } from '@/lib/audit/audit-trail'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import logger from '@/lib/logger'

/**
 * Knowledge Commons — shared, sourced learnings across agents.
 *
 * Each contribution is stored in Postgres with a pgvector embedding for
 * similarity search. Unsourced contributions are rejected outright.
 */

export interface WeeklyLearning {
  summary: string
  source_urls: string[] // MUST be non-empty — unsourced learnings are rejected
  tags: string[]
  agent: AgentId
  memoryType?: string
}

const DEFAULT_MEMORY_TYPE = 'WEEKLY_LEARNING'

export class KnowledgeCommons {
  private deliberationRoom: DeliberationRoom

  constructor(deliberationRoom: DeliberationRoom) {
    this.deliberationRoom = deliberationRoom
  }

  /**
   * Contribute a verified learning to the shared Knowledge Commons.
   * Rejects unsourced learnings with a hard error.
   */
  async contribute(agentId: AgentId, learning: WeeklyLearning): Promise<void> {
    const validUrls = learning.source_urls?.filter((u) => u.startsWith('http') || u.startsWith('internal://'))
    if (!validUrls || validUrls.length === 0) {
      throw new Error(
        `KnowledgeCommons.contribute() rejected: agent ${agentId} attempted to write unsourced learning. ` +
          `All contributions must include at least one source_url.`,
      )
    }

    const embedding = await getEmbedding(learning.summary)

    await db.insert(knowledgeCommons).values({
      agentId,
      memoryType: learning.memoryType || DEFAULT_MEMORY_TYPE,
      summary: learning.summary,
      sourceUrl: validUrls[0],
      tags: [...learning.tags, agentId, 'knowledge_commons'],
      embedding,
      payload: { source_urls: validUrls },
    })

    auditTrail.log({
      pipeline_run_id: 'KNOWLEDGE_GLOBAL',
      agent_id: agentId,
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: {
        summary_preview: learning.summary.slice(0, 200),
        source_urls: validUrls,
        tags: learning.tags,
      },
    })

    logger.info({ agentId, tags: learning.tags }, 'KnowledgeCommons: learning contributed')
  }

  /**
   * Query the Knowledge Commons using pgvector similarity search.
   */
  async queryCommons(agentId: AgentId, topic: string, limit = 5): Promise<WeeklyLearning[]> {
    const topicEmbedding = await getEmbedding(topic)

    const results = await db
      .select()
      .from(knowledgeCommons)
      .where(eq(knowledgeCommons.agentId, agentId))
      .orderBy(sql`${knowledgeCommons.embedding} <=> ${JSON.stringify(topicEmbedding)}`)
      .limit(limit)

    return results.map((row) => ({
      summary: row.summary,
      source_urls: (row.payload as { source_urls?: string[] })?.source_urls ?? [row.sourceUrl],
      tags: (row.tags as string[]) ?? [],
      agent: row.agentId as AgentId,
      memoryType: row.memoryType,
    }))
  }

  /**
   * Called by DHRUV every Friday.
   * Consolidates all agents' weekly learnings into the Knowledge Commons,
   * then broadcasts a DIRECTIVE to the Deliberation Room.
   */
  async consolidate(
    weeklyLearnings: Partial<Record<AgentId, WeeklyLearning[]>>,
    pipeline_run_id: string,
  ): Promise<void> {
    let successCount = 0
    const errors: string[] = []

    for (const [agentId, learnings] of Object.entries(weeklyLearnings) as [AgentId, WeeklyLearning[]][]) {
      if (!learnings || learnings.length === 0) continue

      for (const learning of learnings) {
        try {
          await this.contribute(agentId, learning)
          successCount++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`[${agentId}] ${msg}`)
          logger.warn({ agentId, err }, 'KnowledgeCommons: consolidation skipped one learning')
        }
      }
    }

    const summary =
      `Weekly knowledge consolidation complete. ${successCount} new learning${successCount !== 1 ? 's' : ''} added.` +
      (errors.length > 0 ? ` ${errors.length} rejected (unsourced).` : '')

    logger.info({ successCount, rejectedCount: errors.length }, summary)

    try {
      await this.deliberationRoom.bind(pipeline_run_id).publish({
        sender: 'DHRUV',
        recipient: 'ALL',
        message_type: 'DIRECTIVE',
        content: '',
        payload: {
          directive_type: 'PROCEED',
          instructions: summary,
        },
        references: [],
      })
    } catch (pubErr) {
      // Never let a failed broadcast stop the consolidation record
      logger.error({ pubErr }, 'KnowledgeCommons: failed to publish consolidation DIRECTIVE')
    }
  }

  /**
   * Return recent contributions for an agent, newest first.
   */
  async recent(agentId: AgentId, limit = 10): Promise<WeeklyLearning[]> {
    const results = await db
      .select()
      .from(knowledgeCommons)
      .where(eq(knowledgeCommons.agentId, agentId))
      .orderBy(desc(knowledgeCommons.createdAt))
      .limit(limit)

    return results.map((row) => ({
      summary: row.summary,
      source_urls: (row.payload as { source_urls?: string[] })?.source_urls ?? [row.sourceUrl],
      tags: (row.tags as string[]) ?? [],
      agent: row.agentId as AgentId,
      memoryType: row.memoryType,
    }))
  }
}
