import { z } from 'zod'

/**
 * Life-event types — used to trigger portfolio reviews or full pipeline restarts.
 * No PII is stored; only event classification, optional financial impact, and
 * effective date are captured.
 */

export const LifeEventTypeSchema = z.enum([
  'MARRIAGE',
  'CHILD_BORN',
  'JOB_LOSS',
  'INCOME_INCREASE', // >25% salary hike
  'INCOME_DECREASE', // >25% salary cut
  'INHERITANCE',
  'HOME_PURCHASED',
  'MEDICAL_EMERGENCY',
  'DIVORCE',
  'RETIREMENT_DATE_CHANGE',
])

export const LifeEventSchema = z.object({
  event_type: LifeEventTypeSchema,
  description: z.string().max(1000),
  financial_impact_lakh: z.number().optional(), // net change in monthly income in lakhs
  new_monthly_income_lakh: z.number().positive().optional(),
  effective_date: z.string(), // ISO date when the change occurred
})

export type LifeEvent = z.infer<typeof LifeEventSchema>
export type LifeEventType = z.infer<typeof LifeEventTypeSchema>

// Life events that require a full pipeline restart vs just re-interview
export const MAJOR_LIFE_EVENTS: LifeEventType[] = [
  'MARRIAGE',
  'CHILD_BORN',
  'JOB_LOSS',
  'INCOME_DECREASE',
  'DIVORCE',
  'MEDICAL_EMERGENCY',
]
