import { z } from 'zod'
import { fromBuffer } from 'pdf2pic'
import type { CASExtraction } from '../contracts/cas-validation'
import { getGpt4o } from '../azure-openai'
import { CAS_VISION_PROMPT } from '../prompts/cas-vision'
import { structuredCall } from '../llm/structured-call'
import logger from '../logger'

const BATCH_SIZE = 10

const CASHoldingSchema = z.object({
  folio_number: z.string(),
  scheme_name: z.string(),
  units: z.number(),
  nav: z.number(),
  market_value: z.number(),
  scheme_code: z.string().nullish(),
})

const CASVisionResponseSchema = z.union([
  z.object({
    source: z.enum(['NSDL', 'CDSL']),
    as_of_date: z.string(),
    total_value_reported: z.number(),
    holdings: z.array(CASHoldingSchema),
    _extraction_notes: z.array(z.string()).optional(),
  }),
  z.object({
    error: z.string(),
    reason: z.string(),
  }),
])

type CASVisionResponse = z.infer<typeof CASVisionResponseSchema>

export async function pdfToImageBuffers(buffer: Buffer): Promise<Buffer[]> {
  const convert = fromBuffer(buffer, {
    density: 150,
    format: 'png',
    width: 1700,
    height: 2200,
    preserveAspectRatio: true,
  })

  // pdf2pic needs page count — use a large upper bound and stop on error
  const pages: Buffer[] = []
  let page = 1
  while (true) {
    try {
      const result = await convert(page, { responseType: 'buffer' })
      if (!result?.buffer) break
      pages.push(result.buffer as Buffer)
      page++
    } catch {
      break
    }
  }
  return pages
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

async function callVisionBatch(
  imageBuffers: Buffer[],
  batchIndex: number,
): Promise<CASExtraction | null> {
  const client = getGpt4o()
  const imageContent = imageBuffers.map((buf) => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/png;base64,${buf.toString('base64')}`, detail: 'high' as const },
  }))

  const fallback: CASVisionResponse = {
    error: 'structured_output_failed',
    reason: 'LLM did not return valid CAS JSON after retries',
  }

  const start = Date.now()
  let parsed: CASVisionResponse
  try {
    parsed = await structuredCall({
      client,
      model: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!,
      messages: [
        { role: 'system', content: CAS_VISION_PROMPT.text },
        { role: 'user', content: imageContent },
      ],
      schema: CASVisionResponseSchema,
      schemaName: 'cas_vision_response',
      schemaDescription: 'Extracted mutual fund CAS holdings from document images.',
      temperature: 0,
      fallback,
    })
    logger.info(
      { batchIndex, pages: imageBuffers.length, durationMs: Date.now() - start },
      'cas vision batch complete',
    )
  } catch (e) {
    logger.error({ batchIndex, err: e, durationMs: Date.now() - start }, 'cas vision batch failed')
    return null
  }

  if ('error' in parsed) {
    logger.warn({ batchIndex, error: parsed.error, reason: parsed.reason }, 'vision returned error')
    return null
  }

  return parsed
}

function mergeBatchResults(results: (CASExtraction | null)[]): CASExtraction | null {
  const valid = results.filter((r): r is CASExtraction => r !== null)
  if (valid.length === 0) return null

  const base = valid[0]
  const allHoldings = valid.flatMap((r) => r.holdings)
  const allNotes = valid.flatMap((r) => r._extraction_notes ?? [])

  // Deduplicate holdings by folio + scheme_name
  const seen = new Set<string>()
  const holdings = allHoldings.filter((h) => {
    const key = `${h.folio_number}::${h.scheme_name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    source: base.source,
    as_of_date: base.as_of_date,
    total_value_reported: base.total_value_reported,
    holdings,
    _extraction_notes: allNotes,
  }
}

export async function parseCASVision(buffer: Buffer): Promise<CASExtraction | null> {
  let pages: Buffer[]
  try {
    pages = await pdfToImageBuffers(buffer)
  } catch (e) {
    logger.error({ err: e }, 'pdf2pic conversion failed')
    return null
  }

  if (pages.length === 0) {
    logger.warn('pdf2pic returned 0 pages')
    return null
  }

  const batches = chunk(pages, BATCH_SIZE)
  logger.info({ totalPages: pages.length, batches: batches.length }, 'cas vision: starting batched extraction')

  const batchResults = await Promise.all(
    batches.map((batch, i) => callVisionBatch(batch, i)),
  )

  const failedCount = batchResults.filter((r) => r === null).length
  if (failedCount > 0) {
    logger.warn(
      { failedCount, totalBatches: batches.length },
      'cas vision: some batches failed',
    )
  }
  if (failedCount > batches.length / 2) {
    logger.error(
      { failedCount, totalBatches: batches.length },
      'cas vision: majority of batches failed — aborting to prevent partial portfolio write',
    )
    return null
  }

  return mergeBatchResults(batchResults)
}
