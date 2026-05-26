export type RefusalReason =
  | 'unknown_scheme_code'
  | 'no_factsheet_data'
  | 'contract_violation'
  | 'no_retrieval_result'

export type Citation = {
  chunk_id: string
  factsheet_date: string
  section: string
}

export type RagResponseFormatted = {
  answer: string
  citations: Citation[]
  refused: boolean
  refusal_reason: RefusalReason | null
  scheme_code?: string
  scheme_name?: string
  chunks_retrieved?: number
}
