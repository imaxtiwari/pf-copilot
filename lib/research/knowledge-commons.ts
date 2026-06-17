import { AgentMemoryStore, MemoryEntry, WriteMemoryInput } from '../memory/memory-store'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { AgentId } from '../deliberation/message-schema'
import { randomUUID } from 'crypto'
import logger from '../logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyLearning {
  summary: string
  source_urls: string[]   // MUST be non-empty — unsourced learnings are rejected
  tags: string[]
  agent: AgentId
}

// ─── Knowledge Commons ────────────────────────────────────────────────────────

export class KnowledgeCommons {
  private memoryStore: AgentMemoryStore
  private deliberationRoom: DeliberationRoom

  constructor(memoryStore: AgentMemoryStore, deliberationRoom: DeliberationRoom) {
    this.memoryStore = memoryStore
    this.deliberationRoom = deliberationRoom
  }

  /**
   * Contribute a verified learning to the shared Knowledge Commons.
   * Rejects unsourced learnings with a hard error.
   */
  async contribute(agentId: AgentId, learning: WeeklyLearning): Promise<void> {
    const validUrls = learning.source_urls?.filter(u => u.startsWith('http') || u.startsWith('internal://'))
    if (!validUrls || validUrls.length === 0) {
      throw new Error(
        `KnowledgeCommons.contribute() rejected: agent ${agentId} attempted to write unsourced learning. ` +
        `All contributions must include at least one source_url.`
      )
    }

    const writeInput: WriteMemoryInput & { agent_id: AgentId } = {
      content: learning.summary,
      // Use a general-purpose memory type with long TTL for shared knowledge
      memory_type: 'ARIA_CRITIQUE_REPORT', // 365 days — longest non-infinite TTL
      source_url: validUrls[0],
      confidence_tier: 'VERIFIED',
      tags: [...learning.tags, agentId, 'knowledge_commons'],
      pipeline_run_id: randomUUID(),
      agent_id: agentId
    }

    await this.memoryStore.writeToKnowledgeCommons(writeInput)

    auditTrail.log({
      pipeline_run_id: writeInput.pipeline_run_id!,
      agent_id: agentId,
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: {
        summary_preview: learning.summary.slice(0, 200),
        source_urls: learning.source_urls,
        tags: learning.tags
      }
    })

    logger.info(
      { agentId, tags: learning.tags },
      'KnowledgeCommons: learning contributed'
    )
  }

  /**
   * Query the Knowledge Commons for relevant learnings.
   * Returns ACTIVE entries only (TTL enforced by memory store).
   */
  async query(searchQuery: string, limit = 5, callerAgentId: AgentId = 'DHRUV'): Promise<MemoryEntry[]> {
    return this.memoryStore.recallFromKnowledgeCommons(searchQuery, {
      limit,
      caller_agent_id: callerAgentId
    })
  }

  /**
   * Called by DHRUV every Friday.
   * Consolidates all agents' weekly learnings into the Knowledge Commons,
   * then broadcasts a DIRECTIVE to the Deliberation Room.
   */
  async consolidate(
    weeklyLearnings: Partial<Record<AgentId, WeeklyLearning[]>>,
    pipeline_run_id: string
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

    // Broadcast DIRECTIVE to the Deliberation Room
    try {
      await this.deliberationRoom.publish({
        pipeline_run_id,
        sender: 'DHRUV',
        recipient: 'ALL',
        message_type: 'DIRECTIVE',
        payload: {
          directive_type: 'PROCEED',
          instructions: summary
        },
        references: []
      })
    } catch (pubErr) {
      // Never let a failed broadcast stop the consolidation record
      logger.error({ pubErr }, 'KnowledgeCommons: failed to publish consolidation DIRECTIVE')
    }
  }
}
