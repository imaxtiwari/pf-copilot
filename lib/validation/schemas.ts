import { z } from 'zod'

export const CAS_STATUS = z.enum([
  'pending',
  'extracted_text',
  'extracted_vision',
  'validated',
  'failed_validation',
  'failed_extraction',
])

export const FACTSHEET_SECTION = z.enum([
  'holdings',
  'returns',
  'expense_ratio',
  'fund_manager',
  'aum',
  'sector_allocation',
  'other',
])

export const INFLATION_CONFIDENCE = z.enum(['low', 'medium', 'high'])

export type CasStatus = z.infer<typeof CAS_STATUS>
export type FactsheetSection = z.infer<typeof FACTSHEET_SECTION>
export type InflationConfidence = z.infer<typeof INFLATION_CONFIDENCE>
