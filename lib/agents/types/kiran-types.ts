import { z } from 'zod'

export const MacroRiskBulletinSchema = z.object({
  bulletin_id: z.string().uuid(),
  generated_at: z.string(),
  risk_level: z.enum(['LOW', 'ELEVATED', 'HIGH', 'CRITICAL']),
  rbi_policy_signal: z.string(),
  fed_signal: z.string(),
  india_vix: z.number(),
  india_vix_trend: z.enum(['UP', 'DOWN', 'STABLE']),
  brent_crude_usd: z.number(),
  gold_mcx_inr: z.number(),
  usdinr_rate: z.number(),
  usdinr_trend: z.enum(['UP', 'DOWN', 'STABLE']),
  fii_net_flow_cr: z.number(),
  geopolitical_alerts: z.array(z.string()),
  key_risks: z.array(z.string()),
  key_observations: z.array(z.string()),
  sources: z.array(
    z.object({
      url: z.string(),
      retrieved_at: z.string(),
    })
  ),
})

export type MacroRiskBulletin = z.infer<typeof MacroRiskBulletinSchema>

export const ClientRiskProfileSchema = z.object({
  profile_id: z.string().uuid(),
  client_id: z.string().uuid(),
  version: z.number().int().positive(),
  generated_at: z.string(),
  expires_at: z.string(),
  age: z.number().int().positive(),
  years_to_goal: z.number().int().nonnegative(),
  income_stability_score: z.number().min(1).max(10),
  existing_liabilities: z.string().nullable(),
  dependants: z.enum(['none', 'spouse', 'kids', 'parents', 'multiple']),
  emergency_fund_months: z.number().nonnegative(),
  insurance_coverage: z.string().nullable(),
  tax_bracket_pct: z.number().min(0).max(100),
  behavioural_risk_tolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  stated_risk_tolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  geographic_income_risk: z.string().nullable(),
  factors: z.array(
    z.object({
      factor_name: z.string(),
      value: z.string(),
      source_url: z.string(),
      rationale: z.string(),
    })
  ),
})

export type ClientRiskProfile = z.infer<typeof ClientRiskProfileSchema>

export const HedgeMapSchema = z.object({
  portfolio_id: z.string(),
  generated_at: z.string(),
  positions: z.array(
    z.object({
      fund_name: z.string(),
      scheme_code: z.string(),
      allocation_pct: z.number().min(0).max(100),
      risk_scenario: z.string(),
      hedge_instrument: z.string(),
      hedge_rationale: z.string(),
      contingency_if_hedge_fails: z.string(),
    })
  ),
  overall_hedge_coverage_pct: z.number().min(0).max(100),
  sources: z.array(
    z.object({
      url: z.string(),
      retrieved_at: z.string(),
    })
  ),
})

export type HedgeMap = z.infer<typeof HedgeMapSchema>

export const ScenarioStressTestSchema = z.object({
  portfolio_id: z.string(),
  tested_at: z.string(),
  scenarios: z.array(
    z.object({
      scenario_name: z.string(),
      description: z.string(),
      estimated_portfolio_return_pct: z.number(),
      worst_case_drawdown_pct: z.number(),
      recovery_timeline_months: z.number().nonnegative(),
      most_affected_funds: z.array(z.string()),
      least_affected_funds: z.array(z.string()),
    })
  ),
})

export type ScenarioStressTest = z.infer<typeof ScenarioStressTestSchema>
