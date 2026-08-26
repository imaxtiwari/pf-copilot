import { z } from 'zod'
import { GoalTypeSchema } from '../../types/goal-types'

/**
 * VIKRAM agent types — goal assessment, strategy framework selection, and
 * hypothesis-first client interview. Arrays and long text fields are capped
 * to keep JSONB payloads bounded.
 */

// ── Hypothesis-first interview types ──────────────────────────────────────────

export const EssentialAnswersSchema = z.object({
  age: z.number().int().positive().max(120),
  monthly_take_home_lakh: z.number().positive(),
  biggest_goal: z.string().min(5).max(300),
  goal_timeline_years: z.number().int().positive(),
  risk_reaction: z.enum(['A', 'B', 'C']),
})
export type EssentialAnswers = z.infer<typeof EssentialAnswersSchema>

export const GoalHypothesisAssumptionSchema = z.object({
  field: z.string().max(200),
  value: z.string().max(1000),
  reasoning: z.string().max(2000),
})

export const GoalHypothesisSchema = z.object({
  hypothesis_id: z.string().uuid(),
  generated_at: z.string(),
  corpus_target_lakh: z.number().positive(),
  corpus_target_year: z.number().int().positive(),
  goal_description: z.string().max(1000),
  monthly_sip_required_lakh: z.number().nonnegative(),
  current_monthly_savings_lakh: z.number().nonnegative(),
  required_cagr_pct: z.number(),
  cagr_feasibility: z.enum(['ACHIEVABLE', 'AGGRESSIVE', 'UNREALISTIC']),
  assumed_expenses: z.object({
    rent_lakh: z.number().nonnegative(),
    city_tier: z.string().max(100),
    dependents: z.string().max(100),
  }),
  risk_profile: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
  strategy_framework: z.string().max(1000),
  assumptions: z.array(GoalHypothesisAssumptionSchema).max(50),
  confidence: z.number().min(0).max(100),
})
export type GoalHypothesis = z.infer<typeof GoalHypothesisSchema>

export const UserCorrectionSchema = z.object({
  field: z.string().max(200),
  old_value: z.string().max(1000),
  new_value: z.string().max(1000),
})
export type UserCorrection = z.infer<typeof UserCorrectionSchema>

// ── Core goal types ────────────────────────────────────────────────────────────
export const DecomposedGoalSchema = z.object({
  goal_id: z.string().uuid(),
  goal_type: GoalTypeSchema,
  description: z.string().max(1000),
  target_corpus_lakh: z.number().positive(),
  target_date: z.string(),
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
  stated_goals: z.array(z.string().max(300)).max(10),
  decomposed_goals: z.array(DecomposedGoalSchema).max(10),
  achievability_verdict: z.enum(['ALIGNS_WITH_GOALS', 'NEEDS_DISCUSSION', 'OUT_OF_SCOPE']),
  revised_plan: z.string().max(5000).optional(),
  goal_sequence_conflicts: z.array(z.string().max(500)).max(20),
  sources: z
    .array(
      z.object({
        url: z.string().max(2000),
        retrieved_at: z.string(),
      }),
    )
    .max(50),
  hypothesis_mode: z.boolean().optional().default(false),
  user_corrections: z.array(z.string().max(500)).max(50).optional().default([]),
  correction_rounds: z.number().int().nonnegative().max(100).optional().default(0),
})

export type ClientGoalAssessment = z.infer<typeof ClientGoalAssessmentSchema>

export const StrategyFrameworkSchema = z.object({
  framework_id: z.string().uuid(),
  client_id: z.string().uuid(),
  selected_frameworks: z
    .array(
      z.object({
        name: z.string().max(200),
        description: z.string().max(2000),
        why_applicable: z.string().max(2000),
        source_url: z.string().max(2000),
        retrieved_at: z.string(),
      }),
    )
    .max(10),
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
  evidence: z.array(z.string().max(1000)).max(20),
  implications_for_new_investors: z.string().max(3000),
  sources: z
    .array(
      z.object({
        url: z.string().max(2000),
        retrieved_at: z.string(),
      }),
    )
    .max(50),
})

export type MarketContextBrief = z.infer<typeof MarketContextBriefSchema>

export const InterviewGoalSchema = z.object({
  goal_type: GoalTypeSchema,
  description: z.string().max(500),
  target_corpus_lakh: z.number().positive(),
  current_corpus_lakh: z.number().nonnegative().default(0),
  monthly_sip_required_lakh: z.number().nonnegative().default(0.1),
  target_date: z.string(),
})

export const StructuredInterviewAnswersSchema = z.object({
  monthly_income_lakh: z.number().positive(),
  monthly_expenses_lakh: z.number().nonnegative().optional(),
  existing_investments_lakh: z.number().nonnegative().optional(),
  goals: z.array(InterviewGoalSchema).min(1).max(5),
  risk_appetite_self_reported: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']).optional(),
  investment_horizon_years: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
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
  clientData: unknown
  essentialAnswers: EssentialAnswers
  userCorrections?: string[]
}

