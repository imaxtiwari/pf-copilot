import { z } from 'zod'

/**
 * SOMA agent types — fund profiles, composition audits, watchlist alerts, and
 * the screened fund universe. Collections and long strings are capped to keep
 * JSONB payloads bounded.
 */

export const FundProfileSchema = z.object({
  scheme_code: z.string().max(100),
  isin: z.string().max(20).nullable(),
  scheme_name: z.string().max(500),
  amc: z.string().max(200),
  scheme_type: z.enum(['equity', 'debt', 'hybrid', 'index', 'etf', 'fof', 'solution-oriented']),
  benchmark: z.string().max(500).nullable(),
  fund_manager: z.string().max(200).nullable(),
  fund_manager_tenure_years: z.number().nullable(),
  nav: z.number(),
  nav_date: z.string(),
  aum_cr: z.number().nullable(),
  expense_ratio: z.number().nullable(),
  returns: z.object({
    '1y': z.number().nullable(),
    '3y': z.number().nullable(),
    '5y': z.number().nullable(),
    '10y': z.number().nullable(),
  }),
  alpha_3y: z.number().nullable(),
  sharpe_3y: z.number().nullable(),
  sortino_3y: z.number().nullable(),
  max_drawdown: z.number().nullable(),
  global_influence_factors: z.array(z.string().max(500)).max(50),
  data_freshness: z.object({
    retrieved_at: z.string(),
    is_stale: z.boolean(),
    days_old: z.number(),
  }),
  source_urls: z.array(z.string().max(2000)).max(20),
})

export type FundProfile = z.infer<typeof FundProfileSchema>

export const FundComparisonMatrixSchema = z.object({
  funds: z.array(FundProfileSchema).max(100),
  comparison_dimensions: z.array(z.string().max(200)).max(20),
  overlap_matrix: z.record(z.string().max(100), z.record(z.string().max(100), z.number())),
  research_commentary: z.string().max(10000),
})

export type FundComparisonMatrix = z.infer<typeof FundComparisonMatrixSchema>

export const CompositionAuditSchema = z.object({
  scheme_code: z.string().max(100),
  audit_date: z.string(),
  top_holdings: z
    .array(
      z.object({
        company: z.string().max(500),
        allocation_pct: z.number(),
      }),
    )
    .max(100),
  sector_distribution: z.record(z.string().max(200), z.number()),
  top_10_concentration_pct: z.number().nullable(),
  overlap_with: z.record(z.string().max(100), z.number()),
  source_url: z.string().max(2000),
  retrieved_at: z.string(),
})

export type CompositionAudit = z.infer<typeof CompositionAuditSchema>

export const FundWatchlistAlertSchema = z.object({
  scheme_code: z.string().max(100),
  scheme_name: z.string().max(500),
  alert_type: z.enum(['MANAGER_CHANGE', 'AUM_DROP', 'EXPENSE_RATIO_HIKE', 'BENCHMARK_CHANGE']),
  description: z.string().max(2000),
  detected_at: z.string(),
  source_url: z.string().max(2000),
})

export type FundWatchlistAlert = z.infer<typeof FundWatchlistAlertSchema>

export const FundUniverseSchema = z.object({
  universe_id: z.string().uuid(),
  generated_at: z.string(),
  pipeline_run_id: z.string().uuid(),
  filters_applied: z
    .array(
      z.object({
        filter: z.string().max(200),
        threshold: z.string().max(200),
      }),
    )
    .max(50),
  eligible_funds: z
    .array(
      z.object({
        scheme_code: z.string().max(100),
        scheme_name: z.string().max(500),
        scheme_type: z.enum(['equity', 'debt', 'hybrid', 'index', 'etf', 'fof', 'solution-oriented']),
        aum_cr: z.number().nullable(),
        expense_ratio: z.number().nullable(),
        return_3y: z.number().nullable(),
        sharpe_3y: z.number().nullable(),
        track_record_years: z.number(),
      }),
    )
    .max(500),
  total_screened: z.number().int(),
  total_eligible: z.number().int(),
})

export type FundUniverse = z.infer<typeof FundUniverseSchema>
