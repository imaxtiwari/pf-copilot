import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getGpt4o, getGpt4oMini } from '../azure-openai'
import { EXPLAIN_FUND_PROMPT } from '../prompts/explain-fund'
import { EXPLAIN_FUND_TRANSLATE_PROMPT } from '../prompts/explain-fund-translate'
import { retrieveChunks } from './retrieval'
import { validateRagResponse } from './validate-response'
import type { RagResponseFormatted, RefusalReason, Citation } from '../contracts/refusal-types'
import type { RetrievedChunk } from './retrieval'
import { structuredCall } from '../llm/structured-call'
import logger from '../logger'

// Lazy singletons — avoids creating a new HTTP agent on every RAG call
// and avoids evaluating Azure env vars during `next build` static page-data collection.
let gpt4oClient: ReturnType<typeof getGpt4o> | null = null
let gpt4oMiniClient: ReturnType<typeof getGpt4oMini> | null = null
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!
const GPT4O_MINI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI!

function getGpt4oClient(): ReturnType<typeof getGpt4o> {
  if (!gpt4oClient) {
    gpt4oClient = getGpt4o()
  }
  return gpt4oClient
}

function getGpt4oMiniClient(): ReturnType<typeof getGpt4oMini> {
  if (!gpt4oMiniClient) {
    gpt4oMiniClient = getGpt4oMini()
  }
  return gpt4oMiniClient
}

const ExplainFundResponseSchema = z.object({
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

type ExplainFundResponse = z.infer<typeof ExplainFundResponseSchema>

export type SupportedLanguage = 'en' | 'hi-en'

// ── helpers ───────────────────────────────────────────────────────────────────

function refusedResponse(reason: RefusalReason, message: string): RagResponseFormatted {
  return { answer: message, citations: [], refused: true, refusal_reason: reason }
}

function formatResponse(
  parsed: { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
  chunks: RetrievedChunk[],
  schemeName: string,
  schemeCode: string,
): RagResponseFormatted {
  return {
    answer: parsed.answer,
    citations: parsed.citations,
    refused: parsed.refused,
    refusal_reason: parsed.refusal_reason as RefusalReason | null,
    scheme_code: schemeCode,
    scheme_name: schemeName,
    chunks_retrieved: chunks.length,
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export type ExplainFundOptions = {
  top_k?: number
  language?: SupportedLanguage
}

export async function explainFund(
  scheme_code: string,
  question: string,
  options?: ExplainFundOptions,
): Promise<RagResponseFormatted> {
  const topK = options?.top_k ?? 8
  const language = options?.language ?? 'en'

  if (language !== 'en' && language !== 'hi-en') {
    return refusedResponse(
      'contract_violation',
      `Unsupported language "${language}" requested for explain_fund.`,
    )
  }

  // 1. Resolve scheme
  const scheme = await db.query.amfiSchemeMaster.findFirst({
    where: eq(schema.amfiSchemeMaster.schemeCode, scheme_code),
  })
  if (!scheme) {
    return refusedResponse(
      'unknown_scheme_code',
      `Scheme code ${scheme_code} not found. Could you share the AMFI scheme code or full name?`,
    )
  }

  // 2. Vector retrieval
  const chunks = await retrieveChunks(scheme_code, question, topK)
  if (chunks.length === 0) {
    return refusedResponse(
      'no_factsheet_data',
      `No factsheet data available for ${scheme.schemeName} (${scheme_code}). Try running the factsheet ingestion script first.`,
    )
  }

  const chunkIds = chunks.map((c) => c.id)
  const chunksFormatted = chunks
    .map(
      (c) =>
        `[${c.id}] (section: ${c.section}, dated ${c.factsheetDate})\n${c.chunkText}`,
    )
    .join('\n\n---\n\n')

  // 3. LLM call (with structured output + one-retry on contract violation)
  const fallback: ExplainFundResponse = {
    answer: 'Unable to produce a valid answer at this time. Please try rephrasing your question.',
    citations: [],
    refused: true,
    refusal_reason: 'contract_violation',
  }

  const callLlm = async (extraNudge?: string): Promise<ExplainFundResponse> => {
    const userContent = `Retrieved chunks:\n\n${chunksFormatted}\n\nUser question: ${question}${extraNudge ? `\n\nCorrection: ${extraNudge}` : ''
      }`
    const messages = [
      { role: 'system' as const, content: EXPLAIN_FUND_PROMPT.text },
      { role: 'user' as const, content: userContent },
    ]
    const start = Date.now()
    const parsed = await structuredCall({
      client: getGpt4oClient(),
      model: GPT4O_DEPLOYMENT,
      messages,
      schema: ExplainFundResponseSchema,
      schemaName: 'explain_fund_response',
      schemaDescription: 'JSON answer to a mutual-fund question with citations.',
      temperature: 0.0,
      fallback,
    })
    logger.info(
      {
        schemeCode: scheme_code,
        durationMs: Date.now() - start,
        retry: !!extraNudge,
      },
      'rag: llm call complete',
    )
    return parsed
  }

  let parsed = await callLlm()
  let validation = validateRagResponse(parsed, chunkIds)

  if (!validation.ok) {
    logger.warn({ errors: validation.errors, schemeCode: scheme_code }, 'rag: response failed validation, retrying once')
    const nudge = `Your previous response violated the contract: ${validation.errors.join('; ')}. Try again strictly.`
    parsed = await callLlm(nudge)
    validation = validateRagResponse(parsed, chunkIds)

    if (!validation.ok) {
      logger.error({ errors: validation.errors, schemeCode: scheme_code }, 'rag: retry also failed validation')
      return refusedResponse(
        'contract_violation',
        `LLM violated RAG contract twice: ${validation.errors.join('; ')}`,
      )
    }
  }

  // 4. Optional Hinglish translation (only the prose; citations preserved exactly)
  if (language === 'hi-en') {
    const translated = await translateToHinglish(parsed, chunkIds, scheme_code)
    if (translated) {
      return formatResponse(translated, chunks, scheme.schemeName, scheme_code)
    }
    // Fallback: return validated English response if translation fails validation twice
  }

  return formatResponse(parsed, chunks, scheme.schemeName, scheme_code)
}

async function translateToHinglish(
  english: { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
  chunkIds: string[],
  schemeCode: string,
): Promise<{ answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null } | null> {
  const translatorFallback: ExplainFundResponse = {
    answer: english.answer,
    citations: english.citations,
    refused: english.refused,
    refusal_reason: english.refusal_reason,
  }

  const callTranslator = async (extraNudge?: string): Promise<ExplainFundResponse> => {
    const userContent = `Translate the "answer" field of this JSON into simple Hinglish. Preserve all [chunk_...] citations exactly as they are and copy the citations array unchanged.${extraNudge ? `\n\nCorrection: ${extraNudge}` : ''}\n\n${JSON.stringify(english)}`
    const start = Date.now()
    const parsed = await structuredCall({
      client: getGpt4oMiniClient(),
      model: GPT4O_MINI_DEPLOYMENT,
      messages: [
        { role: 'system' as const, content: EXPLAIN_FUND_TRANSLATE_PROMPT.text },
        { role: 'user' as const, content: userContent },
      ],
      schema: ExplainFundResponseSchema,
      schemaName: 'explain_fund_hinglish_translation',
      schemaDescription: 'Hinglish translation of a fund explanation with unchanged citations.',
      temperature: 0.0,
      fallback: translatorFallback,
    })
    logger.info(
      {
        schemeCode,
        durationMs: Date.now() - start,
        retry: !!extraNudge,
      },
      'rag: hinglish translation complete',
    )
    return parsed
  }

  let translated = await callTranslator()
  let validation = validateRagResponse(translated, chunkIds)

  if (!validation.ok) {
    logger.warn({ errors: validation.errors, schemeCode }, 'rag: hinglish translation failed validation, retrying once')
    translated = await callTranslator(
      `Your previous translation violated the contract: ${validation.errors.join('; ')}. Fix the issue while keeping the answer in Hinglish and citations unchanged.`,
    )
    validation = validateRagResponse(translated, chunkIds)

    if (!validation.ok) {
      logger.error({ errors: validation.errors, schemeCode }, 'rag: hinglish translation retry also failed; falling back to English')
      return null
    }
  }

  const t = translated
  // Extra safety: translated citations must match English citations exactly (order and content).
  const englishCitationsJson = JSON.stringify(english.citations)
  const translatedCitationsJson = JSON.stringify(t.citations)
  if (englishCitationsJson !== translatedCitationsJson) {
    logger.warn({ schemeCode }, 'rag: hinglish translation changed citations; falling back to English')
    return null
  }

  return t
}
