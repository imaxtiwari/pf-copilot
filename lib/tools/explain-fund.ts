import { explainFund as explainFundRag } from '@/lib/rag/explain-fund'
import type { RagResponseFormatted } from '@/lib/contracts/refusal-types'

/** Thin wrapper around the P7 strict-RAG agent. */
export async function explainFundTool(
  schemeCode: string,
  question: string,
): Promise<RagResponseFormatted> {
  return explainFundRag(schemeCode, question)
}
