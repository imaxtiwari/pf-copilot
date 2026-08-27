import { eq, inArray, and, isNull } from 'drizzle-orm'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { makePipelineKey } from '@/lib/memory/memory-store'
import { KnowledgeCommons } from '@/lib/research/knowledge-commons'
import { AgentId } from '@/lib/deliberation/message-schema'
import { getGpt4o } from '@/lib/azure-openai'
import * as schema from '@/db/schema'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'
import { MENTOR_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'

export interface MentorLearning {
  agent: AgentId
  learning: string
  tags: string[]
}

/**
 * MENTOR — Meta-learning agent.
 *
 * Extracts structured, sourced learnings from completed pipeline runs and
 * contributes them to the Knowledge Commons. Never generates portfolio advice.
 */
export class Mentor {
  constructor(
    private deliberationRoom: DeliberationRoom,
    private db: any,
  ) {}

  async runPostPipelineAnalysis(pipelineRunId: string, outcome: 'APPROVED' | 'DEADLOCKED' | 'REJECTED'): Promise<MentorLearning[]> {
    logger.info({ pipelineRunId, outcome }, 'MENTOR: runPostPipelineAnalysis invoked')

    const votes = await this.db
      .select()
      .from(schema.committeeVotes)
      .where(eq(schema.committeeVotes.pipelineRunId, pipelineRunId))
      .orderBy(schema.committeeVotes.votedAt)

    const critiqueMessages = await this.db
      .select()
      .from(schema.deliberationMessages)
      .where(
        and(
          eq(schema.deliberationMessages.pipelineRunId, pipelineRunId),
          inArray(schema.deliberationMessages.messageType, ['CRITIQUE', 'VOTE', 'RISK_ALERT']),
        ),
      )

    const [result] = await this.db
      .select()
      .from(schema.pipelineResults)
      .where(eq(schema.pipelineResults.pipelineRunId, pipelineRunId))
      .limit(1)

    const [run] = await this.db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      .limit(1)

    const roots = await this.db
      .select()
      .from(schema.deliberationMessages)
      .where(
        and(
          eq(schema.deliberationMessages.pipelineRunId, pipelineRunId),
          eq(schema.deliberationMessages.messageType, 'PORTFOLIO_DRAFT'),
          isNull(schema.deliberationMessages.replyToMessageId),
        ),
      )

    const conversationTrees: any[] = []
    for (const root of roots) {
      try {
        const thread = await this.deliberationRoom.receiveThread(root.messageId)
        conversationTrees.push({
          rootMessageId: root.messageId,
          thread: thread.map((m: any) => ({
            message_id: m.message_id,
            reply_to_message_id: m.reply_to_message_id,
            thread_root_id: m.thread_root_id,
            depth: m.depth,
            sender: m.sender,
            message_type: m.message_type,
            payload: m.payload,
          })),
        })
      } catch (err) {
        logger.warn({ err, rootMessageId: root.messageId }, 'MENTOR: failed to load thread')
      }
    }

    const prompt = `
Analyze the completed pipeline run and extract structured learnings.

Outcome: ${outcome}
Revision Cycle: ${run?.revisionCycle || 0}

Votes:
${JSON.stringify(votes, null, 2)}

Critique / Vote / Risk Messages:
${JSON.stringify(
      critiqueMessages.map((m: any) => ({
        sender: m.sender,
        message_type: m.messageType,
        payload: m.metadata?.payload || m.payload,
      })),
      null,
      2,
    )}

Conversation Threads:
${JSON.stringify(conversationTrees, null, 2)}

Pipeline Result:
${JSON.stringify(result, null, 2)}

Instructions:
1. Identify 1-3 specific, actionable learnings per agent.
2. Each learning must cite the pipeline run ID as its source.
3. Do not include any portfolio recommendation or fund advice.
4. Return ONLY valid JSON in this format:
{
  "learnings": [
    { "agent": "ARIA" | "KIRAN" | "VIKRAM" | "PRIYA" | "DHRUV" | "SEBI", "learning": "...", "tags": ["..."] }
  ]
}
`

    let parsed: any = { learnings: [] }
    try {
      const gpt = getGpt4o()
      const response = await gpt.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: MENTOR_SYSTEM_PROMPT_V1 },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || '{}'
      parsed = JSON.parse(rawText.replace(/^```json/, '').replace(/```$/, '').trim())
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'MENTOR: Failed to parse learnings JSON')
      return []
    }

    const learnings: MentorLearning[] = (parsed.learnings || []).map((l: any) => ({
      agent: l.agent,
      learning: l.learning,
      tags: l.tags || [],
    }))

    if (learnings.length === 0) {
      logger.info({ pipelineRunId }, 'MENTOR: No learnings extracted from pipeline run')
      return []
    }

    const knowledgeCommons = new KnowledgeCommons(this.deliberationRoom)
    for (const learning of learnings) {
      await knowledgeCommons.contribute(learning.agent as AgentId, {
        summary: learning.learning,
        source_urls: [`internal://pipeline-run/${pipelineRunId}`],
        tags: [...learning.tags, 'mentor_analysis', outcome.toLowerCase(), makePipelineKey('MENTOR', 'pipeline_learnings', run?.clientId || 'UNKNOWN_CLIENT', pipelineRunId)],
        agent: learning.agent as AgentId,
      })
    }

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: run?.clientId,
      agent_id: 'MENTOR',
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: { learnings_count: learnings.length, outcome },
    })

    logger.info({ pipelineRunId, learningsCount: learnings.length }, 'MENTOR: completed post-pipeline analysis')

    return learnings
  }
}
