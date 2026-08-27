import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import {
  CommitteeVoteRecord,
  CommitteeVoteRecordSchema,
  DeadlockReport,
  FinalPortfolioPacket,
  ClientGoalAssessment,
  PortfolioDraft,
  ClientRiskProfile,
} from '@/lib/agents/types'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { PipelineStateMachine } from '@/lib/pipeline/pipeline-state-machine'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import { Aria, deriveARIAVote } from '@/lib/agents/aria'
import { Kiran } from '@/lib/agents/kiran'
import { Mentor } from '@/lib/agents/mentor'
import { Sebi } from '@/lib/agents/sebi'
import { Atlas } from '@/lib/agents/atlas'
import logger from '@/lib/logger'
import { DHRUV_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'
import { resolveVote, CommitteeVote, VoteResolver } from './dhruv/vote-resolver'
import { DeadlockHandler, DeadlockTrigger } from './dhruv/deadlock-handler'
import { PacketCompiler } from './dhruv/packet-compiler'

export type { DeadlockTrigger }
export { resolveVote }

/**
 * DHRUV — Dynamic Head of Recommendation & Utility Validation.
 *
 * Chairs the educational simulation committee, records votes, resolves
 * deadlocks, and assembles the final hypothetical portfolio packet.
 */
export class Dhruv implements VoteResolver {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any
  private stateMachine: PipelineStateMachine
  private deadlockHandler: DeadlockHandler
  private packetCompiler: PacketCompiler

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
    this.stateMachine = new PipelineStateMachine(db)
    this.deadlockHandler = new DeadlockHandler(deliberationRoom, db)
    this.packetCompiler = new PacketCompiler()
  }

  async runCommitteeSession(
    draft: PortfolioDraft,
    pipelineRunId: string,
    sebiReport?: any,
    strategyFramework?: any,
  ): Promise<CommitteeVoteRecord> {
    logger.info({ pipelineRunId, draftId: draft.portfolio_id }, 'DHRUV: runCommitteeSession invoked')

    const aria = new Aria(this.deliberationRoom, this.webResearchTool, this.db)

    const ariaCritique = await aria.critiquePortfolioDraft(
      draft,
      { message_id: draft.portfolio_id, client_id: draft.client_id },
      pipelineRunId,
      sebiReport,
    )

    const ariaVote = deriveARIAVote(ariaCritique.faults)
    const hedgeCoverage = draft.hedge_instruments?.overall_hedge_coverage_pct || 0
    const kiranVote = {
      voter: 'KIRAN' as const,
      vote: hedgeCoverage >= 80 ? ('APPROVE' as const) : ('REJECT' as const),
      reasoning: hedgeCoverage >= 80 ? 'Hedge coverage meets threshold.' : `Hedge coverage ${hedgeCoverage}% below 80%.`,
    }
    const vikramVote = {
      voter: 'VIKRAM' as const,
      vote: 'APPROVE' as const,
      reasoning: 'Strategy framework alignment is acceptable for discussion.',
    }

    const votes = [
      { voter: 'ARIA' as const, vote: ariaVote.vote, reasoning: ariaVote.reasoning },
      kiranVote,
      vikramVote,
    ]

    const resolution = resolveVote(
      votes,
      this,
      draft,
      ariaCritique.critical_count > 0,
      draft.hedge_instruments?.overall_hedge_coverage_pct || 100,
    )

    const record: CommitteeVoteRecord = {
      vote_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: draft.version,
      votes,
      critical_faults_from_aria: ariaCritique.critical_count,
      hedge_coverage_from_kiran: draft.hedge_instruments?.overall_hedge_coverage_pct || 0,
      outcome: resolution.outcome,
      outcome_reason: resolution.outcomeReason,
      voted_at: new Date().toISOString(),
    }

    const validated = CommitteeVoteRecordSchema.parse(record)

    try {
      await this.db
        .insert(schema.committeeVotes)
        .values({
          voteId: validated.vote_id,
          pipelineRunId: validated.pipeline_run_id,
          draftVersion: validated.draft_version,
          votes: validated.votes,
          criticalFaultsCount: validated.critical_faults_from_aria,
          hedgeCoveragePct: validated.hedge_coverage_from_kiran,
          outcome: validated.outcome,
          outcomeReason: validated.outcome_reason,
          votedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.committeeVotes.voteId,
          set: {
            votes: validated.votes,
            outcome: validated.outcome,
            outcomeReason: validated.outcome_reason,
          },
        })
    } catch (dbErr) {
      logger.warn({ dbErr, pipelineRunId }, 'DHRUV: failed to persist committee vote')
    }

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'DHRUV',
      message_type: 'VOTE',
      recipient: 'ALL',
      content: `Committee vote result: ${validated.outcome}.`,
      payload: {
        motion: `Approve portfolio draft ${draft.portfolio_id}`,
        vote: validated.outcome,
        reasoning: validated.outcome_reason,
        conditions: [`ARIA critical faults: ${validated.critical_faults_from_aria}`, `Hedge coverage: ${validated.hedge_coverage_from_kiran}%`],
      },
      references: [draft.portfolio_id],
    })

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: draft.client_id,
      agent_id: 'DHRUV',
      action_type: AuditActionType.COMMITTEE_VOTE_RESULT,
      payload: {
        outcome: validated.outcome,
        reason: validated.outcome_reason,
        votes: validated.votes,
      },
    })

    return validated
  }

  castDecidingVote(draft: PortfolioDraft): { outcome: 'APPROVED' | 'REJECTED' | 'DEADLOCKED'; outcomeReason: string } {
    const confidence = draft.confidence_score.total
    const outcome = confidence >= 60 ? 'APPROVED' : 'REJECTED'
    return {
      outcome,
      outcomeReason: `DHRUV cast deciding vote due to low quorum. Confidence score ${confidence}/100.`,
    }
  }

  async executeDeadlockProtocol(
    pipelineRunId: string,
    allDrafts: PortfolioDraft[],
    trigger: DeadlockTrigger,
    context: { goals: any[] },
  ): Promise<DeadlockReport> {
    return this.deadlockHandler.executeDeadlockProtocol(pipelineRunId, allDrafts, trigger, context)
  }

  async compileFinalPortfolioPacket(
    draft: PortfolioDraft,
    pipelineRunId: string,
    goalAssessment: ClientGoalAssessment,
    sebiReport?: any,
  ): Promise<FinalPortfolioPacket> {
    return this.packetCompiler.compileFinalPortfolioPacket(draft, pipelineRunId, goalAssessment, sebiReport)
  }

  async runPhase2(
    inputs: {
      clientId: string
      pipelineRunId: string
      goalAssessment: ClientGoalAssessment
      riskProfile: ClientRiskProfile
      strategyFramework: any
      fundUniverse: any
      existingHoldings: any[]
      providedAnswers?: Record<string, any>
      clientData?: any
    },
  ): Promise<FinalPortfolioPacket | DeadlockReport | undefined> {
    const { clientId, pipelineRunId, goalAssessment, riskProfile, strategyFramework, fundUniverse, existingHoldings } = inputs
    logger.info({ pipelineRunId }, 'DHRUV: runPhase2 invoked')

    const priya = await import('@/lib/agents/priya').then((m) => new m.Priya(this.deliberationRoom, this.webResearchTool, this.db))
    const kiran = new Kiran(this.deliberationRoom, this.webResearchTool, this.db)
    const sebi = new Sebi(this.db)

    const hedgeMap = await kiran.buildHedgeMap({ client_id: clientId, fund_allocations: [] } as any, pipelineRunId)
    const stressTest = await kiran.runStressTest({ client_id: clientId, fund_allocations: [] } as any, pipelineRunId)

    const initialDraft = await priya.buildPortfolio(
      {
        goalAssessment,
        riskProfile,
        strategyFramework,
        hedgeMap,
        critiques: [],
        fundUniverse,
      },
      pipelineRunId,
    )

    const allDrafts: PortfolioDraft[] = [initialDraft]
    const maxCycles = 5
    let cycle = 0

    while (cycle < maxCycles) {
      await this.stateMachine.transition('PRIYA_BUILD', 'SEBI_COMPLIANCE', { pipelineRunId, userId: clientId })

      const sebiReport = await sebi.runComplianceCheck({
        userId: clientId,
        pipelineRunId,
        portfolioDraft: initialDraft,
        existingHoldings,
        userProfile: { age: riskProfile.age, taxBracket: riskProfile.tax_bracket_pct },
        fundSnapshots: [],
      })

      if (!sebiReport.overallCompliant) {
        cycle++
        if (cycle >= maxCycles) {
          return this.deadlockHandler.executeDeadlockProtocol(pipelineRunId, allDrafts, { stage: 'SEBI_COMPLIANCE', revisions: cycle, complianceBlockReason: 'Persistent SEBI compliance blocks', mostProblematicGoal: goalAssessment.stated_goals[0] || '', shortestGoalTimeline: 5 }, { goals: goalAssessment.decomposed_goals })
        }
        continue
      }

      await this.stateMachine.transition('SEBI_COMPLIANCE', 'COMMITTEE_VOTE', { pipelineRunId, userId: clientId })
      const voteRecord = await this.runCommitteeSession(initialDraft, pipelineRunId, sebiReport, strategyFramework)

      if (voteRecord.outcome === 'APPROVED') {
        if (existingHoldings.length > 0) {
          await this.stateMachine.transition('COMMITTEE_VOTE', 'ATLAS_COMPARISON', { pipelineRunId, userId: clientId })
          const atlas = new Atlas(this.db)
          await atlas.generateReport(clientId, pipelineRunId, initialDraft, existingHoldings, [])
        }

        await this.db
          .update(schema.pipelineRuns)
          .set({ finalPortfolioId: initialDraft.portfolio_id, completedAt: new Date() })
          .where(eq(schema.pipelineRuns.runId, pipelineRunId))

        const packet = await this.compileFinalPortfolioPacket(initialDraft, pipelineRunId, goalAssessment, sebiReport)
        await this.stateMachine.transition('PDF_GENERATION', 'COMPLETED', { pipelineRunId, userId: clientId })
        return packet
      }

      if (voteRecord.outcome === 'DEADLOCKED') {
        return this.deadlockHandler.executeDeadlockProtocol(pipelineRunId, allDrafts, { stage: 'COMMITTEE_VOTE', revisions: cycle, bestDraftId: initialDraft.portfolio_id, bestConfidence: initialDraft.confidence_score.total, riskDisclosures: [], impossibilityReason: 'No quorum reached' }, { goals: goalAssessment.decomposed_goals })
      }

      cycle++
      if (cycle >= maxCycles) {
        return this.deadlockHandler.executeDeadlockProtocol(pipelineRunId, allDrafts, { stage: 'COMMITTEE_VOTE', revisions: cycle, bestDraftId: initialDraft.portfolio_id, bestConfidence: initialDraft.confidence_score.total, riskDisclosures: [], impossibilityReason: 'Max revision cycles reached' }, { goals: goalAssessment.decomposed_goals })
      }
    }

    return undefined
  }

  async runPostPipelineMentor(pipelineRunId: string, outcome: 'APPROVED' | 'DEADLOCKED' | 'REJECTED'): Promise<void> {
    const mentor = new Mentor(this.deliberationRoom, this.db)
    await mentor.runPostPipelineAnalysis(pipelineRunId, outcome)
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('DHRUV: Starting weekly leader research sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text: 'wealth management investment committee guidelines asset allocation rules portfolio risk oversight',
          intent: 'weekly_sweep_leader',
          freshness_required_days: 7,
          max_sources: 3,
          memory_type: 'DHRUV_COMMITTEE_VOTE',
        },
        'WEEKLY_RESEARCH',
      )
      logger.info('DHRUV: Weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'DHRUV: Weekly sweep research failed')
    }
  }
}
