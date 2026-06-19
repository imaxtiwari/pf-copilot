import { eq } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getGpt4o } from '../azure-openai'
import { EXPLAIN_FUND_PROMPT } from '../prompts/explain-fund'

let gpt4oClient: any = null
function getGpt4oClient() {
  if (!gpt4oClient) gpt4oClient = getGpt4o()
  return gpt4oClient
}
const GPT4O_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || 'gpt-4o'
import { retrieveChunks } from './retrieval'
import { validateRagResponse } from './validate-response'
import type { RagResponseFormatted, RefusalReason, Citation } from '../contracts/refusal-types'
import type { RetrievedChunk } from './retrieval'
import logger from '../logger'

// ── helpers ───────────────────────────────────────────────────────────────────

function refusedResponse(reason: RefusalReason, message: string): RagResponseFormatted {
  return { answer: message, citations: [], refused: true, refusal_reason: reason }
}

function formatResponse(
  parsed: { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
  chunks: RetrievedChunk[],
  schemeName: string,
  schemeCode: string,
  freshness?: import('../contracts/refusal-types').FreshnessMetadata,
  validation_warnings?: string[],
): RagResponseFormatted {
  return {
    answer: parsed.answer,
    citations: parsed.citations,
    refused: parsed.refused,
    refusal_reason: parsed.refusal_reason as RefusalReason | null,
    scheme_code: schemeCode,
    scheme_name: schemeName,
    chunks_retrieved: chunks.length,
    freshness,
    validation_warnings,
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export type ExplainFundOptions = {
  top_k?: number
}

export async function explainFund(
  scheme_code: string,
  question: string,
  options?: ExplainFundOptions,
): Promise<RagResponseFormatted> {
  const topK = options?.top_k ?? 8

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

  // 3. LLM call (with one-retry on contract violation)
  const callLlm = async (extraNudge?: string): Promise<unknown> => {
    const userContent = `Retrieved chunks:\n\n${chunksFormatted}\n\nUser question: ${question}${
      extraNudge ? `\n\nCorrection: ${extraNudge}` : ''
    }`
    const messages = [
      { role: 'system' as const, content: EXPLAIN_FUND_PROMPT.text },
      { role: 'user' as const, content: userContent },
    ]
    const start = Date.now()
    const completion = await getGpt4oClient().chat.completions.create({
      model: GPT4O_DEPLOYMENT,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.0,
    })
    logger.info(
      {
        schemeCode: scheme_code,
        durationMs: Date.now() - start,
        tokens: completion.usage?.total_tokens,
        retry: !!extraNudge,
      },
      'rag: llm call complete',
    )
    const raw = completion.choices[0]?.message?.content ?? '{}'
    try {
      return JSON.parse(raw)
    } catch {
      logger.warn(
        { schemeCode: scheme_code, raw: raw.slice(0, 200) },
        'rag: LLM returned non-JSON',
      )
      return {}  // validateRagResponse will fail this and trigger the refusal path
    }
  }

  let parsed = await callLlm()
  let validation = validateRagResponse(parsed, chunks)

  if (!validation.ok) {
    logger.warn({ errors: validation.errors, schemeCode: scheme_code }, 'rag: response failed validation, retrying once')
    const nudge = `Your previous response violated the contract: ${validation.errors.join('; ')}. Try again strictly.`
    parsed = await callLlm(nudge)
    validation = validateRagResponse(parsed, chunks)

    if (!validation.ok) {
      logger.error({ errors: validation.errors, schemeCode: scheme_code }, 'rag: retry also failed validation')
      return refusedResponse(
        'contract_violation',
        `LLM violated RAG contract twice: ${validation.errors.join('; ')}`,
      )
    }
  }

  // 4. Compute freshness and append footer
  const dates = chunks.map(c => new Date(c.factsheetDate).getTime()).filter(t => !isNaN(t))
  let freshness: import('../contracts/refusal-types').FreshnessMetadata | undefined = undefined
  
  if (dates.length > 0 && !(parsed as any).refused) {
    const oldestTime = Math.min(...dates)
    const oldestChunkDate = new Date(oldestTime)
    const ageInDays = Math.floor((Date.now() - oldestTime) / 86400000)
    let staleness: 'fresh' | 'aging' | 'stale' | 'critical' = 'fresh'
    if (ageInDays > 180) staleness = 'critical'
    else if (ageInDays > 90) staleness = 'stale'
    else if (ageInDays > 30) staleness = 'aging'
    else staleness = 'fresh'

    freshness = { oldestChunkDate, ageInDays, staleness }
    const dateStr = oldestChunkDate.toISOString().split('T')[0]
    
    if (ageInDays <= 30) {
      (parsed as any).answer += `\n\n_Data sourced from factsheet dated ${dateStr}. Up to date._`
    } else if (ageInDays <= 90) {
      (parsed as any).answer += `\n\n_Data sourced from factsheet dated ${dateStr} (${ageInDays} days ago). Verify current figures at the AMC website._`
    } else {
      (parsed as any).answer += `\n\n⚠️ _Data sourced from factsheet dated ${dateStr} (${ageInDays} days ago). This may be significantly outdated. Check the AMC website for current data._`
    }
  }

  return formatResponse(
    parsed as { answer: string; citations: Citation[]; refused: boolean; refusal_reason: string | null },
    chunks,
    scheme.schemeName,
    scheme_code,
    freshness,
    validation.warnings
  )
}
