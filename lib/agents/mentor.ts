import { DeliberationRoom } from '../deliberation/deliberation-room'
import { AgentMemoryStore, makePipelineKey } from '../memory/memory-store'
import { KnowledgeCommons } from '../research/knowledge-commons'
import { AgentId } from '../deliberation/message-schema'
import { getGpt4o } from '../azure-openai'
import { eq, inArray, and, isNull, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import logger from '../logger'

export const MENTOR_SYSTEM_PROMPT = `You are MENTOR, a meta-learning agent in a multi-agent portfolio intelligence system. Your sole purpose is to analyze completed pipeline runs and extract structured, sourced learnings that make other agents more effective over time.
You do NOT generate portfolio recommendations. You do NOT evaluate specific funds. You analyze patterns in agent reasoning, voting outcomes, and critique history to produce learning statements that improve each agent's future performance.
Every learning you produce MUST be:
1. Specific (not generic)
2. Actionable (another agent can immediately apply it)
3. Sourced (cite the pipeline run ID as the data source)
4. Non-advisory (no "buy", "sell", "recommend", "invest in")`

export class Mentor {
  constructor(
    private deliberationRoom: DeliberationRoom,
    private memoryStore: AgentMemoryStore,
    private db: any
  ) {}

  async runPostPipelineAnalysis(
    pipelineRunId: string,
    outcome: 'APPROVED' | 'DEADLOCKED'
  ): Promise<void> {
    logger.info({ pipelineRunId, outcome }, 'MENTOR: runPostPipelineAnalysis invoked')

    // A. Gather all pipeline artifacts
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
          inArray(schema.deliberationMessages.messageType, ['CRITIQUE', 'VOTE', 'RISK_ALERT'])
        )
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

    const revisionCycle = run ? run.revisionCycle : 0

    // Retrieve threaded conversation trees
    const roots = await this.db
      .select()
      .from(schema.deliberationMessages)
      .where(
        and(
          eq(schema.deliberationMessages.pipelineRunId, pipelineRunId),
          eq(schema.deliberationMessages.messageType, 'PORTFOLIO_DRAFT'),
          isNull(schema.deliberationMessages.replyToMessageId)
        )
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
            timestamp: m.timestamp
          }))
        })
      } catch (err) {
        logger.warn({ err, rootId: root.messageId }, 'MENTOR: Failed to fetch thread for root message')
      }
    }

    // B. Build the LLM prompt for GPT-4o
    const prompt = `Analyze this completed portfolio advisory pipeline and extract specific, actionable learnings for each agent, as well as an analysis of the deliberation conversation trees.
Pipeline Outcome: ${outcome}
Revision Cycles: ${revisionCycle}

Committee Vote History:
${JSON.stringify(votes, null, 2)}

Critique Reports from Deliberation Room:
${JSON.stringify(critiqueMessages, null, 2)}

Threaded Conversation Trees (showing replies and conversation flow):
${JSON.stringify(conversationTrees, null, 2)}

Instructions:
1. For each agent that participated (ARIA, KIRAN, VIKRAM, PRIYA), extract 1-2 specific learnings.
   A learning must answer: "What should this agent do differently or prioritize in future pipelines based on what happened in this one?"
2. Analyze the threaded conversation tree(s) above:
   - For each ARIA critique message in the tree:
     - Identify the faults ARIA raised and classify each fault into one of: 'METHODOLOGY' | 'CONCENTRATION' | 'SURVIVORSHIP_BIAS' | 'RECENCY_BIAS' | 'GOAL_MISMATCH' | 'COMPLIANCE' | 'OTHER'.
     - Determine if PRIYA addressed this fault in her next revised portfolio draft (the draft replying to that critique).
     - If she resolved/addressed it, pattern is 'ARIA_CRITIQUE_ADDRESSED'. If she ignored it (the same fault category remains in subsequent critiques/votes), pattern is 'ARIA_CRITIQUE_IGNORED'.
     - Calculate the confidence delta: the difference in portfolio confidence score before vs. after this revision cycle (e.g. if the draft before critique had confidence score 60 and the revised draft had 80, delta is 20).
     - revisionCycle is the revision_number/revisionCycle of the revised draft.

Your JSON output must be a valid JSON object only, matching this schema:
{
  "learnings": [
    {
      "agent": "ARIA" | "KIRAN" | "VIKRAM" | "PRIYA" | "DHRUV",
      "learning": "Specific learning statement",
      "reason": "Why this learning is relevant, citing specific evidence from this run",
      "tags": ["tag1", "tag2"]
    }
  ],
  "critique_analyses": [
    {
      "pattern": "ARIA_CRITIQUE_ADDRESSED" | "ARIA_CRITIQUE_IGNORED",
      "critiqueCategory": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "COMPLIANCE" | "OTHER",
      "revisionCycle": number,
      "confidenceDelta": number
    }
  ]
}
CRITICAL: Do NOT include investment advice. Focus on agent reasoning patterns, not portfolio outcomes.`

    const gpt = getGpt4o()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: MENTOR_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 4096,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    
    let parsed: {
      learnings: Array<{ agent: string; learning: string; reason: string; tags: string[] }>
      critique_analyses?: Array<{ pattern: string; critiqueCategory: string; revisionCycle: number; confidenceDelta: number }>
    }
    try {
      parsed = JSON.parse(cleanJson)
    } catch (err) {
      logger.error({ err, rawText }, 'MENTOR: Failed to parse LLM response as JSON')
      throw new Error('MENTOR analysis response is not valid JSON')
    }

    const learnings = parsed.learnings || []
    const critiqueAnalyses = parsed.critique_analyses || []

    // Log critique analyses as structured learnings
    for (const analysis of critiqueAnalyses) {
      logger.info({ analysis }, 'MENTOR: logged critique analysis')
      auditTrail.log({
        pipeline_run_id: pipelineRunId,
        agent_id: 'DHRUV',
        action_type: 'CRITIQUE_THREAD_ANALYSIS' as any,
        payload: {
          pattern: analysis.pattern,
          critiqueCategory: analysis.critiqueCategory,
          revisionCycle: analysis.revisionCycle,
          confidenceDelta: analysis.confidenceDelta
        }
      })
    }

    if (learnings.length === 0) {
      logger.info({ pipelineRunId }, 'MENTOR: No learnings extracted from pipeline run')
      return
    }

    // C. Parse the response and write to Knowledge Commons
    const knowledgeCommons = new KnowledgeCommons(this.deliberationRoom)
    for (const learning of learnings) {
      await knowledgeCommons.contribute(learning.agent as AgentId, {
        summary: learning.learning,
        source_urls: [`internal://pipeline-run/${pipelineRunId}`], // internal source ref
        tags: [...(learning.tags || []), 'mentor_analysis', outcome.toLowerCase(), makePipelineKey('MENTOR', 'pipeline_learnings', run ? run.clientId : 'UNKNOWN_CLIENT', pipelineRunId)],
        agent: learning.agent as AgentId
      })
    }

    // C2. Hypothesis Accuracy meta-learning
    try {
      if (result && result.data) {
        const data = result.data as any
        const goalAssessment = data.client_goal_summary
        if (goalAssessment && goalAssessment.hypothesis_mode) {
          const userId = run ? run.clientId : 'UNKNOWN_CLIENT'
          const memoryKey = `VIKRAM:goal_hypothesis:${userId}:${pipelineRunId}`
          const recalled = await this.memoryStore.recall('VIKRAM', memoryKey, {
            limit: 1,
            pipeline_run_id: pipelineRunId
          })
          if (recalled.length > 0) {
            const hypothesis = JSON.parse(recalled[0].content)
            const totalAssumptions = hypothesis.assumptions ? hypothesis.assumptions.length : 1
            const correctionsCount = goalAssessment.user_corrections ? goalAssessment.user_corrections.length : 0
            const accuracyPct = Math.max(0, Math.round(((totalAssumptions - correctionsCount) / totalAssumptions) * 100))

            await knowledgeCommons.contribute('VIKRAM', {
              summary: `Hypothesis accuracy: ${accuracyPct}% of assumptions were accepted without correction`,
              source_urls: [`internal://pipeline-run/${pipelineRunId}`],
              tags: ['hypothesis_accuracy', 'mentor_analysis', 'vikram_hypothesis'],
              agent: 'VIKRAM'
            })
            logger.info({ pipelineRunId, accuracyPct }, 'MENTOR: logged hypothesis accuracy learning')
          }
        }
      }
    } catch (mentorErr) {
      logger.warn({ mentorErr, pipelineRunId }, 'MENTOR: Failed to log hypothesis accuracy learning')
    }

    // D. Log to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV', // MENTOR operates under DHRUV's authority
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: { learnings_count: learnings.length, outcome }
    })

    logger.info({ pipelineRunId, learningsCount: learnings.length }, 'MENTOR: completed post-pipeline analysis successfully')
  }
}
