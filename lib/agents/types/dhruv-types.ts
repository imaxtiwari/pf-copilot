import { z } from 'zod'
import { ClientGoalAssessmentSchema } from './vikram-types'
import { PortfolioDraftSchema, BacktestSummarySchema, PortfolioConfidenceScoreSchema } from './priya-types'
import { HedgeMapSchema } from './kiran-types'
import { CritiqueFaultSchema } from './aria-types'

export const PipelineStageSchema = z.enum([
  'ONBOARDING',
  'PROFILING_AND_GOAL_ASSESSMENT',
  'SOMA_FUND_UNIVERSE',
  'VIKRAM_STRATEGY',
  'KIRAN_HEDGE_MAP',
  'ARIA_PREFLIGHT',
  'PRIYA_BUILD',
  'DELIBERATION',
  'COMMITTEE_VOTE',
  'REVISION',
  'APPROVED',
  'DEADLOCKED',
  'FAILED'
])

export type PipelineStage = z.infer<typeof PipelineStageSchema>

export const CommitteeVoteRecordSchema = z.object({
  vote_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  draft_version: z.number().int().positive(),
  votes: z.array(
    z.object({
      voter: z.enum(['ARIA', 'KIRAN', 'VIKRAM', 'DHRUV']),
      vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN', 'ERROR']),
      reasoning: z.string(),
    })
  ),
  critical_faults_from_aria: z.number().nonnegative(),
  hedge_coverage_from_kiran: z.number().nonnegative(),
  outcome: z.enum(['APPROVED', 'REJECTED', 'DEADLOCKED']),
  outcome_reason: z.string(),
  voted_at: z.string(),
})

export type CommitteeVoteRecord = z.infer<typeof CommitteeVoteRecordSchema>

export const DeadlockReportSchema = z.object({
  report_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  triggered_at: z.string(),
  revision_cycles_completed: z.number().nonnegative(),
  agent_objections: z.array(
    z.object({
      agent: z.string(),
      objection_summary: z.string(),
      unresolved_faults: z.array(z.string()),
    })
  ),
  dhruv_compromise_proposal: z.string(),
  compromise_vote_outcome: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
  recommended_action: z.string(),
})

export type DeadlockReport = z.infer<typeof DeadlockReportSchema>

export const FinalPortfolioPacketSchema = z.object({
  packet_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  client_id: z.string().uuid(),
  generated_at: z.string(),
  valid_until: z.string(),
  executive_summary: z.string().refine(
    (val) => {
      const wordCount = val.trim().split(/\s+/).filter(Boolean).length
      return wordCount <= 500
    },
    { message: 'Executive summary must not exceed 500 words.' }
  ),
  client_goal_summary: ClientGoalAssessmentSchema,
  achievability_verdict: z.enum(['ACHIEVABLE', 'REVISED', 'IMPOSSIBLE']),
  full_portfolio: PortfolioDraftSchema,
  risk_and_hedge_map: HedgeMapSchema,
  backtest_summary: BacktestSummarySchema,
  confidence_score_breakdown: PortfolioConfidenceScoreSchema,
  open_observations: z.array(CritiqueFaultSchema), // MINOR and OBSERVATION faults
  sebi_disclaimer: z.string(),
  data_freshness_disclosure: z.string(),
  backtest_disclaimer: z.string(),
  conflict_of_interest_disclosure: z.string(),
  validity_disclosure: z.string(),
  audit_trail_pipeline_run_id: z.string(),
})

export type FinalPortfolioPacket = z.infer<typeof FinalPortfolioPacketSchema>
