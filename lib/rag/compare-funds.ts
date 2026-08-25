import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getGpt4o } from '../azure-openai'
import { COMPARE_FUNDS_PROMPT } from '../prompts/compare-funds'
import { retrieveChunks, type RetrievedChunk } from './retrieval'
import { validateRagResponse } from './validate-response'
import type { RagResponseFormatted, RefusalReason, Citation } from '../contracts/refusal-types'
import { structuredCall } from '../llm/structured-call'
import logger from '../logger'

const CompareFundsResponseSchema = z.object({
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

type CompareFundsResponse = z.infer<typeof CompareFundsResponseSchema>

// Lazy singletons — avoids creating a new HTTP agent on every RAG call
// and avoids evaluating Azure env vars during `next build` static page-data collection.
let gpt4oClient: ReturnType<typeof getGpt4o> | null = null
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!

function getGpt4oClient(): ReturnType<typeof getGpt4o> {
  if (!gpt4oClient) {
    gpt4oClient = getGpt4o()
  }
  return gpt4oClient
}

// ── helpers ───────────────────────────────────────────────────────────────────

function refusedResponse(reason: RefusalReason, message: string): RagResponseFormatted {
    return { answer: message, citations: [], refused: true, refusal_reason: reason }
}

function formatResponse(
    parsed: { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
    chunks: RetrievedChunk[],
    schemeCodes: string[],
    schemeNames: Record<string, string>,
): RagResponseFormatted {
    return {
        answer: parsed.answer,
        citations: parsed.citations,
        refused: parsed.refused,
        refusal_reason: parsed.refusal_reason as RefusalReason | null,
        scheme_codes: schemeCodes,
        scheme_names: schemeNames,
        chunks_retrieved: chunks.length,
    }
}

// ── main export ───────────────────────────────────────────────────────────────

export type CompareFundsOptions = {
    top_k?: number
}

export async function compareFunds(
    schemeCodes: string[],
    question: string,
    options?: CompareFundsOptions,
): Promise<RagResponseFormatted> {
    const topKPerScheme = options?.top_k ?? 6

    // 1. Resolve schemes
    const rows = await db
        .select({
            schemeCode: schema.amfiSchemeMaster.schemeCode,
            schemeName: schema.amfiSchemeMaster.schemeName,
        })
        .from(schema.amfiSchemeMaster)
        .where(inArray(schema.amfiSchemeMaster.schemeCode, schemeCodes))

    const foundCodes = new Set(rows.map((r) => r.schemeCode))
    const missingCodes = schemeCodes.filter((c) => !foundCodes.has(c))
    if (missingCodes.length > 0) {
        return refusedResponse(
            'unknown_scheme_code',
            `Scheme code(s) not found: ${missingCodes.join(', ')}. Could you share the AMFI scheme code or full name?`,
        )
    }

    const schemeNames = Object.fromEntries(rows.map((r) => [r.schemeCode, r.schemeName]))

    // 2. Vector retrieval per scheme, preserving provenance
    const allChunks: RetrievedChunk[] = []
    for (const code of schemeCodes) {
        const chunks = await retrieveChunks(code, question, topKPerScheme)
        if (chunks.length === 0) {
            return refusedResponse(
                'no_factsheet_data',
                `No factsheet data available for ${schemeNames[code]} (${code}). I can only compare funds when every requested scheme has factsheet data. Try running the factsheet ingestion script first.`,
            )
        }
        allChunks.push(...chunks)
    }

    const chunkIds = allChunks.map((c) => c.id)
    const chunksFormatted = allChunks
        .map(
            (c) =>
                `[${c.id}] (scheme: ${c.schemeName}, section: ${c.section}, dated ${c.factsheetDate})\n${c.chunkText}`,
        )
        .join('\n\n---\n\n')

    // 3. LLM call (with structured output + one-retry on contract violation)
    const fallback: CompareFundsResponse = {
        answer: 'Unable to produce a valid comparison at this time. Please try rephrasing your question.',
        citations: [],
        refused: true,
        refusal_reason: 'contract_violation',
    }

    const callLlm = async (extraNudge?: string): Promise<CompareFundsResponse> => {
        const schemesHeader = schemeCodes
            .map((code) => `- ${code}: ${schemeNames[code]}`)
            .join('\n')
        const userContent = `Schemes to compare:\n${schemesHeader}\n\nRetrieved chunks:\n\n${chunksFormatted}\n\nUser question: ${question}${extraNudge ? `\n\nCorrection: ${extraNudge}` : ''
            }`
        const messages = [
            { role: 'system' as const, content: COMPARE_FUNDS_PROMPT.text },
            { role: 'user' as const, content: userContent },
        ]
        const start = Date.now()
        const parsed = await structuredCall({
            client: getGpt4oClient(),
            model: GPT4O_DEPLOYMENT,
            messages,
            schema: CompareFundsResponseSchema,
            schemaName: 'compare_funds_response',
            schemaDescription: 'JSON comparison of mutual fund schemes with citations.',
            temperature: 0.0,
            fallback,
        })
        logger.info(
            {
                schemeCodes,
                durationMs: Date.now() - start,
                retry: !!extraNudge,
            },
            'rag: compare-funds llm call complete',
        )
        return parsed
    }

    const chunksByScheme: Record<string, string[]> = {}
    for (const c of allChunks) {
        if (!chunksByScheme[c.schemeCode]) chunksByScheme[c.schemeCode] = []
        chunksByScheme[c.schemeCode].push(c.id)
    }

    let parsed = await callLlm()
    let validation = validateRagResponse(parsed, chunkIds, {
        requiredSchemeCodes: schemeCodes,
        chunksByScheme,
    })

    if (!validation.ok) {
        logger.warn({ errors: validation.errors, schemeCodes }, 'rag: compare-funds response failed validation, retrying once')
        const nudge = `Your previous response violated the contract: ${validation.errors.join('; ')}. Try again strictly.`
        parsed = await callLlm(nudge)
        validation = validateRagResponse(parsed, chunkIds, {
            requiredSchemeCodes: schemeCodes,
            chunksByScheme,
        })

        if (!validation.ok) {
            logger.error({ errors: validation.errors, schemeCodes }, 'rag: compare-funds retry also failed validation')
            return refusedResponse(
                'contract_violation',
                `LLM violated RAG contract twice: ${validation.errors.join('; ')}`,
            )
        }
    }

    return formatResponse(parsed, allChunks, schemeCodes, schemeNames)
}
