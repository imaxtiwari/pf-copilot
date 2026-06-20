import { z } from 'zod'
import { ClientGoalAssessmentSchema } from './vikram-types'
import { FundUniverseSchema } from './soma-types'
import { ClientRiskProfileSchema } from './kiran-types'

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
  fault_description: z.string().refine(
    (val) => val.split(/\s+/).filter(Boolean).length <= 200,
    { message: 'Fault description must be at most 200 words' }
  ),
  evidence_sources: z.array(
    z.object({
      url: z.string(),
      retrieved_at: z.string(),
      excerpt_summary: z.string(),
    })
  ),
  severity: SeveritySchema,
  suggested_remedy: z
    .string()
    .refine(
      (val) => !val || val.split(/\s+/).filter(Boolean).length <= 100,
      { message: 'Suggested remedy must be at most 100 words' }
    )
    .optional(),
  confidence_tier: z.enum(['VERIFIED', 'INFERRED', 'ASSUMED']),
  from_fault_library: z.boolean().optional(),
})

export type CritiqueFault = z.infer<typeof CritiqueFaultSchema>

export const CritiqueReportSchema = z.object({
  report_id: z.string().uuid(),
  pipeline_run_id: z.string(),
  draft_version: z.number().int().positive(),
  critiqued_at: z.string(),
  faults: z.array(CritiqueFaultSchema),
  critical_count: z.number().nonnegative(),
  major_count: z.number().nonnegative(),
  minor_count: z.number().nonnegative(),
  observation_count: z.number().nonnegative(),
  overall_assessment: z.string(),
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
  predictedFailureModes: z.array(
    z.object({
      faultCategory: FaultCategorySchema,
      severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']),
      description: z.string(),
      avoidanceGuidance: z.string(),
    })
  ),
  generatedAt: z.date(),
  pipelineRunId: z.string(),
})

export type PreflightReport = z.infer<typeof PreflightReportSchema>
