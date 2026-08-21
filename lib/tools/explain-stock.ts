import { explainStock, type SupportedLanguage } from '@/lib/rag/explain-stock'
import type { RagResponseFormatted } from '@/lib/contracts/refusal-types'

/** Thin wrapper around the strict-RAG stock explainer. */
export async function explainStockTool(
    isin: string,
    question: string,
    language: SupportedLanguage = 'en',
): Promise<RagResponseFormatted> {
    return explainStock(isin, question, { language })
}
