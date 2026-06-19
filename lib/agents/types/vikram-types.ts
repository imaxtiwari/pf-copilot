import { z } from 'zod'

// ── Hypothesis-first interview types ──────────────────────────────────────────

export const EssentialAnswersSchema = z.object({
  age: z.number().int().positive(),
  monthly_take_home_lakh: z.number().positive(),
  biggest_goal: z.string().min(5).max(300),
  goal_timeline_years: z.number().int().positive(),
  risk_reaction: z.enum(['A', 'B', 'C']), // A=Panic sell, B=Hold, C=Buy more
})
export type EssentialAnswers = z.infer<typeof EssentialAnswersSchema>

export const GoalHypothesisAssumptionSchema = z.object({
  field: z.string(),
  value: z.string(),
  reasoning: z.string(),
})

export const GoalHypothesisSchema = z.object({
  hypothesis_id: z.string().uuid(),
  generated_at: z.string(),
  corpus_target_lakh: z.number().positive(),
  corpus_target_year: z.number().int().positive(),
  goal_description: z.string(),
  monthly_sip_required_lakh: z.number().nonnegative(),
  current_monthly_savings_lakh: z.number().nonnegative(),
  required_cagr_pct: z.number(),
  cagr_feasibility: z.enum(['ACHIEVABLE', 'AGGRESSIVE', 'UNREALISTIC']),
  assumed_expenses: z.object({
    rent_lakh: z.number().nonnegative(),
    city_tier: z.string(),
    dependents: z.string(),
  }),
  risk_profile: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
  strategy_framework: z.string(),
  assumptions: z.array(GoalHypothesisAssumptionSchema),
  confidence: z.number().min(0).max(100),
})
export type GoalHypothesis = z.infer<typeof GoalHypothesisSchema>

export const UserCorrectionSchema = z.object({
  field: z.string(),
  old_value: z.string(),
  new_value: z.string(),
})
export type UserCorrection = z.infer<typeof UserCorrectionSchema>

// ── Core goal types ────────────────────────────────────────────────────────────
export const DecomposedGoalSchema = z.object({
  goal_id: z.string().uuid(),
  goal_type: z.enum([
    'RETIREMENT',
    'CHILD_EDUCATION',
    'HOME_PURCHASE',
    'EMERGENCY_CORPUS',
    'WEALTH_CREATION',
    'VACATION',
    'CUSTOM',
  ]),
  description: z.string(),
  target_corpus_lakh: z.number().positive(),
  target_date: z.string(), // ISO date or string YYYY-MM-DD
  current_corpus_lakh: z.number().nonnegative(),
  monthly_sip_required_lakh: z.number().nonnegative(),
  required_cagr_pct: z.number(),
  inflation_adjusted_target_lakh: z.number().positive(),
  inflation_rate_used_pct: z.number().nonnegative(),
})

export type DecomposedGoal = z.infer<typeof DecomposedGoalSchema>

export const ClientGoalAssessmentSchema = z.object({
  assessment_id: z.string().uuid(),
  client_id: z.string().uuid(),
  version: z.number().int().positive(),
  assessed_at: z.string(),
  expires_at: z.string(),
  stated_goals: z.array(z.string()),
  decomposed_goals: z.array(DecomposedGoalSchema),
  achievability_verdict: z.enum(['ACHIEVABLE', 'REVISED', 'IMPOSSIBLE']),
  revised_plan: z.string().optional(),
  goal_sequence_conflicts: z.array(z.string()),
  sources: z.array(
    z.object({
      url: z.string(),
      retrieved_at: z.string(),
    })
  ),
  // Hypothesis-first interview metadata
  hypothesis_mode: z.boolean().optional().default(false),
  user_corrections: z.array(z.string()).optional().default([]),
  correction_rounds: z.number().int().nonnegative().optional().default(0),
})

export type ClientGoalAssessment = z.infer<typeof ClientGoalAssessmentSchema>

export const StrategyFrameworkSchema = z.object({
  framework_id: z.string().uuid(),
  client_id: z.string().uuid(),
  selected_frameworks: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      why_applicable: z.string(),
      source_url: z.string(),
      retrieved_at: z.string(),
    })
  ),
  asset_allocation_guidance: z.object({
    equity_pct_range: z.tuple([z.number(), z.number()]),
    debt_pct_range: z.tuple([z.number(), z.number()]),
    gold_pct_range: z.tuple([z.number(), z.number()]),
    international_pct_range: z.tuple([z.number(), z.number()]),
  }),
})

export type StrategyFramework = z.infer<typeof StrategyFrameworkSchema>

export const MarketContextBriefSchema = z.object({
  brief_id: z.string().uuid(),
  generated_at: z.string(),
  market_regime: z.enum(['EARLY_BULL', 'LATE_BULL', 'BEAR', 'RECOVERY', 'SIDEWAYS']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidence: z.array(z.string()),
  implications_for_new_investors: z.string(),
  sources: z.array(
    z.object({
      url: z.string(),
      retrieved_at: z.string(),
    })
  ),
})

export type MarketContextBrief = z.infer<typeof MarketContextBriefSchema>

export const InterviewGoalSchema = z.object({
  goal_type: z.enum(['RETIREMENT', 'CHILD_EDUCATION', 'HOME_PURCHASE', 'EMERGENCY_CORPUS', 'WEALTH_CREATION', 'VACATION', 'CUSTOM']),
  description: z.string(),
  target_corpus_lakh: z.number().positive(),
  current_corpus_lakh: z.number().nonnegative().default(0),
  monthly_sip_required_lakh: z.number().nonnegative().default(0.1),
  target_date: z.string(),   // ISO date or YYYY-MM-DD
})

export const StructuredInterviewAnswersSchema = z.object({
  monthly_income_lakh: z.number().positive(),
  monthly_expenses_lakh: z.number().nonnegative().optional(),
  existing_investments_lakh: z.number().nonnegative().optional(),
  goals: z.array(InterviewGoalSchema).min(1).max(5),
  risk_appetite_self_reported: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']).optional(),
  investment_horizon_years: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

export type StructuredInterviewAnswers = z.infer<typeof StructuredInterviewAnswersSchema>

export interface EssentialQuestion {
  id: string
  text: string
  type: 'text' | 'number' | 'choice'
  options?: string[]
}

export interface HypothesisInterviewContext {
  userId: string
  clientData: any
  essentialAnswers: EssentialAnswers
  userCorrections?: string[]
}


