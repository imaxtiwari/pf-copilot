import { z } from 'zod'

export const FundProfileSchema = z.object({
  scheme_code: z.string(),
  isin: z.string().nullable(),
  scheme_name: z.string(),
  amc: z.string(),
  scheme_type: z.enum(['equity', 'debt', 'hybrid', 'index', 'etf', 'fof', 'solution-oriented']),
  benchmark: z.string().nullable(),
  fund_manager: z.string().nullable(),
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
  global_influence_factors: z.array(z.string()),
  data_freshness: z.object({
    retrieved_at: z.string(),
    is_stale: z.boolean(),
    days_old: z.number(),
  }),
  source_urls: z.array(z.string()),
})

export type FundProfile = z.infer<typeof FundProfileSchema>

export const FundComparisonMatrixSchema = z.object({
  funds: z.array(FundProfileSchema),
  comparison_dimensions: z.array(z.string()),
  overlap_matrix: z.record(z.string(), z.record(z.string(), z.number())),
  research_commentary: z.string(),
})

export type FundComparisonMatrix = z.infer<typeof FundComparisonMatrixSchema>

export const CompositionAuditSchema = z.object({
  scheme_code: z.string(),
  audit_date: z.string(),
  top_holdings: z.array(
    z.object({
      company: z.string(),
      allocation_pct: z.number(),
    })
  ),
  sector_distribution: z.record(z.string(), z.number()),
  top_10_concentration_pct: z.number().nullable(),
  overlap_with: z.record(z.string(), z.number()),
  source_url: z.string(),
  retrieved_at: z.string(),
})

export type CompositionAudit = z.infer<typeof CompositionAuditSchema>

export const FundWatchlistAlertSchema = z.object({
  scheme_code: z.string(),
  scheme_name: z.string(),
  alert_type: z.enum(['MANAGER_CHANGE', 'AUM_DROP', 'EXPENSE_RATIO_HIKE', 'BENCHMARK_CHANGE']),
  description: z.string(),
  detected_at: z.string(),
  source_url: z.string(),
})

export type FundWatchlistAlert = z.infer<typeof FundWatchlistAlertSchema>
