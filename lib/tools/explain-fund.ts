import { explainFund as explainFundRag, type SupportedLanguage } from '@/lib/rag/explain-fund'
import type { RagResponseFormatted } from '@/lib/contracts/refusal-types'

/** Thin wrapper around the P7 strict-RAG agent. */
export async function explainFundTool(
  schemeCode: string,
  question: string,
  language: SupportedLanguage = 'en',
): Promise<RagResponseFormatted> {
  return explainFundRag(schemeCode, question, { language })
}
