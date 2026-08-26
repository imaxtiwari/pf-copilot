import { z } from 'zod'
import { ClientGoalAssessmentSchema } from './vikram-types'
import { FundUniverseSchema } from './soma-types'
import { ClientRiskProfileSchema } from './kiran-types'

/**
 * ARIA agent types — preflight risk prediction and portfolio critique.
 * Descriptions and evidence lists are capped to keep JSONB payloads bounded.
 */

export const FaultCategorySchema = z.enum([
  'METHODOLOGY',
  'CONCENTRATION',
  'SURVIVORSHIP_BIAS',
  'RECENCY_BIAS',
  'GOAL_MISMATCH',
  'OTHER',
])

export type FaultCategory = z.infer<typeof FaultCategorySchema>

export const SeveritySchema = z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION'])

export type Severity = z.infer<typeof SeveritySchema>

export const CritiqueFaultSchema = z.object({
  fault_id: z.string().uuid(),
  fault_category: FaultCategorySchema,
  fault_description: z
    .string()
    .max(3000)
    .refine(
      (val) => val.split(/\s+/).filter(Boolean).length <= 200,
      { message: 'Fault description must be at most 200 words' },
    ),
  evidence_sources: z
    .array(
      z.object({
        url: z.string().max(2000),
        retrieved_at: z.string(),
        excerpt_summary: z.string().max(2000),
      }),
    )
    .max(20),
  severity: SeveritySchema,
  suggested_remedy: z
    .string()
    .max(2000)
    .refine(
      (val) => !val || val.split(/\s+/).filter(Boolean).length <= 100,
      { message: 'Suggested remedy must be at most 100 words' },
    )
    .optional(),
  confidence_tier: z.enum(['VERIFIED', 'INFERRED', 'ASSUMED']),
  from_fault_library: z.boolean().optional(),
})

export type CritiqueFault = z.infer<typeof CritiqueFaultSchema>

export const CritiqueReportSchema = z.object({
  report_id: z.string().uuid(),
  pipeline_run_id: z.string().max(100),
  draft_version: z.number().int().positive(),
  critiqued_at: z.string(),
  faults: z.array(CritiqueFaultSchema).max(100),
  critical_count: z.number().nonnegative(),
  major_count: z.number().nonnegative(),
  minor_count: z.number().nonnegative(),
  observation_count: z.number().nonnegative(),
  overall_assessment: z.string().max(5000),
})

export type CritiqueReport = z.infer<typeof CritiqueReportSchema>

export const PreflightContextSchema = z.object({
  userId: z.string().uuid(),
  pipelineRunId: z.string().uuid(),
  goalProfile: ClientGoalAssessmentSchema,
  fundUniverse: FundUniverseSchema,
  clientRiskProfile: ClientRiskProfileSchema,
})

export type PreflightContext = z.infer<typeof PreflightContextSchema>

export const PreflightReportSchema = z.object({
  predictedFailureModes: z
    .array(
      z.object({
        faultCategory: FaultCategorySchema,
        severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']),
        description: z.string().max(2000),
        avoidanceGuidance: z.string().max(2000),
      }),
    )
    .max(50),
  generatedAt: z.date(),
  pipelineRunId: z.string().uuid(),
})

export type PreflightReport = z.infer<typeof PreflightReportSchema>
