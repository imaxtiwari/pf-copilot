import { DeliberationRoom } from '../deliberation/deliberation-room'
import { AgentMemoryStore, makePipelineKey } from '../memory/memory-store'
import { KnowledgeCommons } from '../research/knowledge-commons'
import { AgentId } from '../deliberation/message-schema'
import { getGpt4o } from '../azure-openai'
import { eq, inArray, and } from 'drizzle-orm'
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

    // B. Build the LLM prompt for GPT-4o
    const prompt = `Analyze this completed portfolio advisory pipeline and extract specific, actionable learnings for each agent.
Pipeline Outcome: ${outcome}
Revision Cycles: ${revisionCycle}

Committee Vote History:
${JSON.stringify(votes, null, 2)}

Critique Reports from Deliberation Room:
${JSON.stringify(critiqueMessages, null, 2)}

Instructions:
For each agent that participated (ARIA, KIRAN, VIKRAM, PRIYA), extract 1-2 specific learnings.
A learning must answer: "What should this agent do differently or prioritize in future pipelines based on what happened in this one?"
Return valid JSON only:
{
  "learnings": [
    {
      "agent": "ARIA" | "KIRAN" | "VIKRAM" | "PRIYA" | "DHRUV",
      "learning": "Specific learning statement",
      "reason": "Why this learning is relevant, citing specific evidence from this run",
      "tags": ["tag1", "tag2"]
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
    
    let parsed: { learnings: Array<{ agent: string; learning: string; reason: string; tags: string[] }> }
    try {
      parsed = JSON.parse(cleanJson)
    } catch (err) {
      logger.error({ err, rawText }, 'MENTOR: Failed to parse LLM response as JSON')
      throw new Error('MENTOR analysis response is not valid JSON')
    }

    const learnings = parsed.learnings || []
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
