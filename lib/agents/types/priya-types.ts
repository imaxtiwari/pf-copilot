import { z } from 'zod'
import { GoalTypeSchema } from '../../types/goal-types'
import { HedgeMapSchema, ScenarioStressTestSchema } from './kiran-types'
import { CritiqueFaultSchema } from './aria-types'
import { StrategyFrameworkSchema } from './vikram-types'

/**
 * PRIYA agent types — goal buckets, fund allocations, backtest summaries,
 * confidence scores, and the portfolio draft. Collections are capped so the
 * draft remains safe when persisted as JSONB.
 */

export const GoalBucketSchema = z.object({
  bucket_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_type: GoalTypeSchema,
  target_corpus_lakh: z.number().positive(),
  target_date: z.string(),
  time_horizon_years: z.number(),
  risk_profile: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
  allocation_pct: z.number().min(0).max(100),
})

export type GoalBucket = z.infer<typeof GoalBucketSchema>

export const FundAllocationSchema = z.object({
  allocation_id: z.string().uuid(),
  fund_name: z.string().max(500),
  isin: z.string().max(20),
  scheme_code: z.string().max(100),
  allocation_pct: z.number().min(0).max(100),
  goal_bucket_id: z.string().uuid(),
  rationale: z.string().max(2000),
  fund_profile_retrieved_at: z.string(),
  overlap_checked: z.boolean(),
})

export type FundAllocation = z.infer<typeof FundAllocationSchema>

export const BacktestSummarySchema = z.object({
  backtest_id: z.string().uuid(),
  period_years: z.number().min(5),
  start_date: z.string(),
  end_date: z.string(),
  portfolio_cagr_pct: z.number(),
  benchmark_cagr_pct: z.number(),
  alpha_pct: z.number(),
  max_drawdown_pct: z.number(),
  max_drawdown_recovery_months: z.number(),
  sharpe_ratio: z.number(),
  sortino_ratio: z.number(),
  data_completeness_pct: z.number(),
  proxy_funds_used: z
    .array(
      z.object({
        original: z.string().max(500),
        proxy: z.string().max(500),
        reason: z.string().max(1000),
      }),
    )
    .max(20),
  scenario_overlay: ScenarioStressTestSchema,
})

export type BacktestSummary = z.infer<typeof BacktestSummarySchema>

export const PortfolioConfidenceScoreSchema = z.object({
  total: z.number().min(0).max(100),
  breakdown: z.object({
    data_freshness: z.union([z.literal(0), z.literal(20)]),
    goal_achievability: z.union([z.literal(0), z.literal(10), z.literal(20)]),
    hedge_completeness: z.union([z.literal(0), z.literal(20)]),
    critique_severity: z.union([z.literal(0), z.literal(10), z.literal(20)]),
    backtest_quality: z.union([z.literal(0), z.literal(20)]),
  }),
  blocking_reasons: z.array(z.string().max(500)).max(20),
})

export type PortfolioConfidenceScore = z.infer<typeof PortfolioConfidenceScoreSchema>

export const PortfolioDraftSchema = z.object({
  portfolio_id: z.string().uuid(),
  client_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  version: z.number().int().positive(),
  revision_number: z.number().int().nonnegative(),
  goal_buckets: z.array(GoalBucketSchema).max(20),
  fund_allocations: z.array(FundAllocationSchema).max(100),
  hedge_instruments: HedgeMapSchema,
  confidence_score: PortfolioConfidenceScoreSchema,
  backtest_summary: BacktestSummarySchema,
  open_critique_items: z.array(CritiqueFaultSchema).max(100),
  universe_filters_applied: z
    .array(
      z.object({
        filter: z.string().max(200),
        threshold: z.string().max(200),
      }),
    )
    .max(50),
  overlap_flags: z
    .array(
      z.object({
        fund_a: z.string().max(100),
        fund_b: z.string().max(100),
        overlap_pct: z.number(),
      }),
    )
    .max(200),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']),
  strategy_framework: StrategyFrameworkSchema.optional(),
})

export type PortfolioDraft = z.infer<typeof PortfolioDraftSchema>
