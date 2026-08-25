import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getGpt4o } from '../azure-openai'
import { EXPLAIN_STOCK_PROMPT } from '../prompts/explain-stock'
import { retrieveStockChunks } from './retrieval-stock'
import { validateRagResponse } from './validate-response'
import type { RagResponseFormatted, RefusalReason, Citation } from '../contracts/refusal-types'
import type { RetrievedStockChunk } from './retrieval-stock'
import { structuredCall } from '../llm/structured-call'
import logger from '../logger'

// Lazy singleton — avoids creating a new HTTP agent on every RAG call
// and avoids evaluating Azure env vars during `next build` static page-data collection.
let gpt4oClient: ReturnType<typeof getGpt4o> | null = null
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!

function getGpt4oClient(): ReturnType<typeof getGpt4o> {
  if (!gpt4oClient) {
    gpt4oClient = getGpt4o()
  }
  return gpt4oClient
}

const ExplainStockResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      chunk_id: z.string(),
      factsheet_date: z.string(),
      section: z.string(),
    }),
  ),
  refused: z.boolean(),
  refusal_reason: z.string().nullable(),
})

type ExplainStockResponse = z.infer<typeof ExplainStockResponseSchema>

export type SupportedLanguage = 'en' | 'hi-en'

function refusedResponse(reason: RefusalReason, message: string): RagResponseFormatted {
    return { answer: message, citations: [], refused: true, refusal_reason: reason }
}

function formatResponse(
    parsed: { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
    chunks: RetrievedStockChunk[],
    isin: string,
    companyName: string,
): RagResponseFormatted {
    return {
        answer: parsed.answer,
        citations: parsed.citations,
        refused: parsed.refused,
        refusal_reason: parsed.refusal_reason as RefusalReason | null,
        isin,
        company_name: companyName,
        chunks_retrieved: chunks.length,
    }
}

export type ExplainStockOptions = {
    top_k?: number
    language?: SupportedLanguage
}

export async function explainStock(
    isin: string,
    question: string,
    options?: ExplainStockOptions,
): Promise<RagResponseFormatted> {
    const topK = options?.top_k ?? 8
    const language = options?.language ?? 'en'

    if (language !== 'en' && language !== 'hi-en') {
        return refusedResponse(
            'contract_violation',
            `Unsupported language "${language}" requested for explain_stock.`,
        )
    }

    // Resolve company name from the latest stock document row for this ISIN.
    const doc = await db.query.stockDocuments.findFirst({
        where: eq(schema.stockDocuments.isin, isin),
        orderBy: (t, { desc }) => [desc(t.documentDate)],
    })
    if (!doc) {
        return refusedResponse(
            'no_factsheet_data',
            `No annual report or announcement data available for ${isin}. Try running the stock document ingestion script first.`,
        )
    }

    const chunks = await retrieveStockChunks(isin, question, topK)
    if (chunks.length === 0) {
        return refusedResponse(
            'no_factsheet_data',
            `No relevant document chunks found for ${doc.companyName} (${isin}).`,
        )
    }

    const chunkIds = chunks.map((c) => c.id)
    const chunksFormatted = chunks
        .map(
            (c) =>
                `[${c.id}] (section: ${c.section}, dated ${c.documentDate}, source: ${c.sourceUrl})\n${c.chunkText}`,
        )
        .join('\n\n---\n\n')

    const fallback: ExplainStockResponse = {
        answer: 'Unable to produce a valid stock explanation at this time. Please try rephrasing your question.',
        citations: [],
        refused: true,
        refusal_reason: 'contract_violation',
    }

    const callLlm = async (extraNudge?: string): Promise<ExplainStockResponse> => {
        const userContent = `Retrieved chunks:\n\n${chunksFormatted}\n\nUser question: ${question}${extraNudge ? `\n\nCorrection: ${extraNudge}` : ''}`
        const messages = [
            { role: 'system' as const, content: EXPLAIN_STOCK_PROMPT.text },
            { role: 'user' as const, content: userContent },
        ]
        const start = Date.now()
        const parsed = await structuredCall({
            client: getGpt4oClient(),
            model: GPT4O_DEPLOYMENT,
            messages,
            schema: ExplainStockResponseSchema,
            schemaName: 'explain_stock_response',
            schemaDescription: 'JSON answer to a stock question with citations.',
            temperature: 0.0,
            fallback,
        })
        logger.info(
            {
                isin,
                durationMs: Date.now() - start,
                retry: !!extraNudge,
            },
            'rag: stock llm call complete',
        )
        return parsed
    }

    let parsed = await callLlm()
    let validation = validateRagResponse(parsed, chunkIds)

    if (!validation.ok) {
        logger.warn({ errors: validation.errors, isin }, 'rag: stock response failed validation, retrying once')
        const nudge = `Your previous response violated the contract: ${validation.errors.join('; ')}. Try again strictly.`
        parsed = await callLlm(nudge)
        validation = validateRagResponse(parsed, chunkIds)

        if (!validation.ok) {
            logger.error({ errors: validation.errors, isin }, 'rag: stock retry also failed validation')
            return refusedResponse(
                'contract_violation',
                `LLM violated RAG contract twice: ${validation.errors.join('; ')}`,
            )
        }
    }

    return formatResponse(parsed, chunks, isin, doc.companyName)
}
