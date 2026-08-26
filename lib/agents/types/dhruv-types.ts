import { z } from 'zod'
import { ClientGoalAssessmentSchema } from './vikram-types'
import { PortfolioDraftSchema, BacktestSummarySchema, PortfolioConfidenceScoreSchema } from './priya-types'
import { HedgeMapSchema } from './kiran-types'
import { CritiqueFaultSchema } from './aria-types'

/**
 * DHRUV agent types — committee governance, deadlock resolution, and final
 * client-facing packet assembly. All payloads are bounded so they remain safe
 * when stored as JSONB in Postgres.
 */

export const PipelineStageSchema = z.enum([
  'ONBOARDING',
  'RIYA_BEHAVIORAL_PROFILING',
  'PROFILING_AND_GOAL_ASSESSMENT',
  'SOMA_FUND_UNIVERSE',
  'VIKRAM_STRATEGY',
  'KIRAN_HEDGE_MAP',
  'ARIA_PREFLIGHT',
  'PRIYA_BUILD',
  'SEBI_COMPLIANCE',
  'DELIBERATION',
  'COMMITTEE_VOTE',
  'REVISION',
  'ATLAS_COMPARISON',
  'PDF_GENERATION',
  'APPROVED',
  'DEADLOCKED',
  'FAILED',
])

export type PipelineStage = z.infer<typeof PipelineStageSchema>

export const CommitteeVoteRecordSchema = z.object({
  vote_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  draft_version: z.number().int().positive(),
  votes: z
    .array(
      z.object({
        voter: z.enum(['ARIA', 'KIRAN', 'VIKRAM', 'DHRUV']),
        vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN', 'ERROR']),
        reasoning: z.string().max(2000),
      }),
    )
    .max(10),
  critical_faults_from_aria: z.number().nonnegative(),
  hedge_coverage_from_kiran: z.number().nonnegative(),
  outcome: z.enum(['APPROVED', 'REJECTED', 'DEADLOCKED']),
  outcome_reason: z.string().max(1000),
  voted_at: z.string(),
})

export type CommitteeVoteRecord = z.infer<typeof CommitteeVoteRecordSchema>

export const DeadlockReportSchema = z.object({
  report_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  triggered_at: z.string(),
  revision_cycles_completed: z.number().nonnegative(),
  agent_objections: z
    .array(
      z.object({
        agent: z.string().max(100),
        objection_summary: z.string().max(1000),
        unresolved_faults: z.array(z.string().max(500)).max(50),
      }),
    )
    .max(20),
  dhruv_compromise_proposal: z.string().max(5000),
  compromise_vote_outcome: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
  recommended_action: z.string().max(2000),
})

export type DeadlockReport = z.infer<typeof DeadlockReportSchema>

export const FinalPortfolioPacketSchema = z.object({
  packet_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  client_id: z.string().uuid(),
  generated_at: z.string(),
  valid_until: z.string(),
  executive_summary: z
    .string()
    .max(30000)
    .refine(
      (val) => {
        const wordCount = val.trim().split(/\s+/).filter(Boolean).length
        return wordCount <= 500
      },
      { message: 'Executive summary must not exceed 500 words.' },
    ),
  client_goal_summary: ClientGoalAssessmentSchema,
  achievability_verdict: z.enum(['ALIGNS_WITH_GOALS', 'NEEDS_DISCUSSION', 'OUT_OF_SCOPE']),
  full_portfolio: PortfolioDraftSchema,
  risk_and_hedge_map: HedgeMapSchema,
  backtest_summary: BacktestSummarySchema,
  confidence_score_breakdown: PortfolioConfidenceScoreSchema,
  open_observations: z.array(CritiqueFaultSchema).max(50),
  sebi_disclaimer: z.string().max(5000),
  data_freshness_disclosure: z.string().max(5000),
  backtest_disclaimer: z.string().max(5000),
  conflict_of_interest_disclosure: z.string().max(5000),
  validity_disclosure: z.string().max(5000),
  audit_trail_pipeline_run_id: z.string(),
})

export type FinalPortfolioPacket = z.infer<typeof FinalPortfolioPacketSchema>
