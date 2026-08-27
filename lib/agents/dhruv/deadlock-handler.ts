import { randomUUID } from 'crypto'
import { eq, asc } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { DeadlockReport, DeadlockReportSchema, PortfolioDraft } from '@/lib/agents/types'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import { getGpt4o } from '@/lib/azure-openai'
import logger from '@/lib/logger'
import { DHRUV_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'

export type DeadlockTrigger =
  | { stage: 'SEBI_COMPLIANCE'; revisions: number; complianceBlockReason: string; mostProblematicGoal: string; shortestGoalTimeline: number }
  | { stage: 'ARIA_CRITIQUE'; revisions: number; persistentFaultCategory: string }
  | { stage: 'PRIYA_DRAFTING'; revisions: number; impossibilityReason: string; bestDraftId: string; bestConfidence: number; riskDisclosures: string[] }
  | { stage: 'ARIA_PREFLIGHT'; impossibilityReason: string }
  | { stage: 'COMMITTEE_VOTE'; revisions: number; bestDraftId: string; bestConfidence: number; riskDisclosures: string[] }

export class DeadlockHandler {
  constructor(
    private deliberationRoom: DeliberationRoom,
    private db: any,
  ) {}

  async executeDeadlockProtocol(
    pipelineRunId: string,
    allDrafts: PortfolioDraft[],
    trigger: DeadlockTrigger,
    context: { goals: any[] },
  ): Promise<DeadlockReport> {
    logger.warn({ pipelineRunId, trigger }, 'DHRUV: Executing deadlock protocol')

    let voteRecords: any[] = []
    try {
      voteRecords = await this.db
        .select()
        .from(schema.committeeVotes)
        .where(eq(schema.committeeVotes.pipelineRunId, pipelineRunId))
        .orderBy(asc(schema.committeeVotes.votedAt))
    } catch (dbErr) {
      logger.error({ dbErr, pipelineRunId }, 'DHRUV: failed to fetch committee votes from database')
    }

    const critiqueMessages = (await this.deliberationRoom.bind(pipelineRunId).getHistory())
      .filter((m) => m.message_type === 'CRITIQUE')

    const draftsSummary = allDrafts.map((d) => ({
      portfolio_id: d.portfolio_id,
      version: d.version,
      revision_number: d.revision_number,
      total_confidence_score: d.confidence_score.total,
      fund_allocations: d.fund_allocations.map((fa) => ({ fund_name: fa.fund_name, allocation_pct: fa.allocation_pct })),
    }))

    let compromiseProposal = 'No compromise could be reached automatically. The committee should review the objections manually.'
    let rootCause = 'Persistent disagreement across committee agents.'
    let agentObjections: { agent: string; objection_summary: string; unresolved_faults: string[] }[] = []
    let recommendedAction = ''

    try {
      const gpt = getGpt4o()
      const prompt = `
You are resolving a committee deadlock after ${trigger.revisions ?? allDrafts.length - 1} revision cycles in an educational simulation.
Analyze the objection and voting history to determine the root cause and formulate a specific, actionable compromise for discussion.

Vote Records History:
${JSON.stringify(
        voteRecords.map((r) => ({
          voter: r.voter,
          vote: r.vote,
          reasoning: r.reasoning,
          critical_faults_count: r.criticalFaultsCount,
          hedge_coverage_pct: r.hedgeCoveragePct,
          voted_at: r.votedAt,
        })),
        null,
        2,
      )}

Deliberation Critique Messages:
${JSON.stringify(
        critiqueMessages.map((m) => ({
          sender: m.sender,
          objections: m.payload.critique_points,
          severity: m.payload.severity,
          recommended_action: m.payload.recommended_action,
          timestamp: m.timestamp,
        })),
        null,
        2,
      )}

Portfolio Drafts Evaluated:
${JSON.stringify(draftsSummary, null, 2)}

Return valid JSON only:
{
  "compromise_proposal": "string",
  "root_cause": "string",
  "agent_objections": [{ "agent": "string", "objection_summary": "string", "unresolved_faults": ["string"] }],
  "recommended_action": "string"
}
`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: DHRUV_SYSTEM_PROMPT_V1 },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || '{}'
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      if (parsed.compromise_proposal) compromiseProposal = parsed.compromise_proposal
      if (parsed.root_cause) rootCause = parsed.root_cause
      if (parsed.agent_objections) agentObjections = parsed.agent_objections
      if (parsed.recommended_action) recommendedAction = parsed.recommended_action
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'DHRUV: executeDeadlockProtocol LLM call failed. Using fallback compromise.')
    }

    const bestDraft = allDrafts.reduce((best, d) => (d.confidence_score.total > best.confidence_score.total ? d : best), allDrafts[0])

    if (!recommendedAction) {
      recommendedAction = `Deploying fallback portfolio draft ${bestDraft.portfolio_id} which has the highest confidence score: ${bestDraft.confidence_score.total}/100 for discussion.`
    }

    const report: DeadlockReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      triggered_at: new Date().toISOString(),
      revision_cycles_completed: trigger.revisions ?? allDrafts.length - 1,
      agent_objections: agentObjections,
      dhruv_compromise_proposal: compromiseProposal,
      compromise_vote_outcome: 'ACCEPTED',
      recommended_action: recommendedAction,
    }

    const validated = DeadlockReportSchema.parse(report)

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.PIPELINE_DEADLOCK,
      payload: {
        revision_cycles: validated.revision_cycles_completed,
        compromise: validated.dhruv_compromise_proposal,
        action: validated.recommended_action,
      },
    })

    let triggeringMessageId: string | undefined
    try {
      const history = await this.deliberationRoom.bind(pipelineRunId).getHistory()
      const latestMsg = [...history].reverse().find((m) => m.message_type === 'VOTE' || m.message_type === 'CRITIQUE' || m.message_type === 'PORTFOLIO_DRAFT')
      if (latestMsg) triggeringMessageId = latestMsg.message_id
    } catch (err) {
      logger.warn({ err }, 'DHRUV: Failed to find triggering message in history')
    }

    await this.deliberationRoom.bind(pipelineRunId).send(
      {
        sender: 'DHRUV',
        message_type: 'DIRECTIVE',
        recipient: 'ALL',
        content: `Deadlock protocol activated. ${compromiseProposal}`,
        payload: {
          directive_type: 'HALT',
          instructions: recommendedAction,
          compromise_proposal: compromiseProposal,
          root_cause: rootCause,
          best_draft_id: bestDraft.portfolio_id,
          best_confidence_score: bestDraft.confidence_score.total,
        },
        references: triggeringMessageId ? [triggeringMessageId] : [],
      },
      triggeringMessageId,
    )

    return validated
  }
}
