import { compareFunds as compareFundsRag } from '@/lib/rag/compare-funds'
import type { RagResponseFormatted } from '@/lib/contracts/refusal-types'

/** Thin wrapper around the multi-fund strict-RAG comparison agent. */
export async function compareFundsTool(
    schemeCodes: string[],
    question: string,
): Promise<RagResponseFormatted> {
    return compareFundsRag(schemeCodes, question)
}
