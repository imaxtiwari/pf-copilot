import { eq } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getGpt4o } from '../azure-openai'
import { EXPLAIN_STOCK_PROMPT } from '../prompts/explain-stock'
import { retrieveStockChunks } from './retrieval-stock'
import { validateRagResponse } from './validate-response'
import type { RagResponseFormatted, RefusalReason, Citation } from '../contracts/refusal-types'
import type { RetrievedStockChunk } from './retrieval-stock'
import logger from '../logger'

const gpt4oClient = getGpt4o()
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!

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

    const callLlm = async (extraNudge?: string): Promise<unknown> => {
        const userContent = `Retrieved chunks:\n\n${chunksFormatted}\n\nUser question: ${question}${extraNudge ? `\n\nCorrection: ${extraNudge}` : ''}`
        const messages = [
            { role: 'system' as const, content: EXPLAIN_STOCK_PROMPT.text },
            { role: 'user' as const, content: userContent },
        ]
        const start = Date.now()
        const completion = await gpt4oClient.chat.completions.create({
            model: GPT4O_DEPLOYMENT,
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.0,
        })
        logger.info(
            {
                isin,
                durationMs: Date.now() - start,
                tokens: completion.usage?.total_tokens,
                retry: !!extraNudge,
            },
            'rag: stock llm call complete',
        )
        const raw = completion.choices[0]?.message?.content ?? '{}'
        try {
            return JSON.parse(raw)
        } catch {
            logger.warn({ isin, raw: raw.slice(0, 200) }, 'rag: stock LLM returned non-JSON')
            return {}
        }
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

    return formatResponse(
        parsed as { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
        chunks,
        isin,
        doc.companyName,
    )
}
