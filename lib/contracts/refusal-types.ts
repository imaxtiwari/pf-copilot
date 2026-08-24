export type RefusalReason =
  | 'unknown_scheme_code'
  | 'no_factsheet_data'
  | 'contract_violation'
  | 'no_retrieval_result'
  | 'cost_budget_exceeded'

export type Citation = {
  chunk_id: string
  factsheet_date: string
  section: string
}

export type FreshnessMetadata = {
  oldestChunkDate: Date
  ageInDays: number
  staleness: 'fresh' | 'aging' | 'stale' | 'critical'
}

export type RagResponseFormatted = {
  answer: string
  citations: Citation[]
  refused: boolean
  refusal_reason: RefusalReason | null
  scheme_code?: string
  scheme_name?: string
  scheme_codes?: string[]
  scheme_names?: Record<string, string>
  isin?: string
  company_name?: string
  chunks_retrieved?: number
  freshness?: FreshnessMetadata
  validation_warnings?: string[]
}
