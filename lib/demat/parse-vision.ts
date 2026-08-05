import { fromBuffer } from 'pdf2pic'
import type { DematExtraction } from '../contracts/demat-validation'
import { getGpt4o } from '../azure-openai'
import { DEMAT_VISION_PROMPT } from '../prompts/demat-vision'
import logger from '../logger'
import { pdfToImageBuffers as casPdfToImageBuffers, chunk } from '../cas/parse-vision'

const BATCH_SIZE = 10

export async function pdfToImageBuffers(buffer: Buffer): Promise<Buffer[]> {
    return casPdfToImageBuffers(buffer)
}

async function callVisionBatch(
    imageBuffers: Buffer[],
    batchIndex: number,
): Promise<DematExtraction | null> {
    const client = getGpt4o()
    const imageContent = imageBuffers.map((buf) => ({
        type: 'image_url' as const,
        image_url: { url: `data:image/png;base64,${buf.toString('base64')}`, detail: 'high' as const },
    }))

    const start = Date.now()
    let raw: string
    try {
        const response = await client.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O!,
            messages: [
                { role: 'system', content: DEMAT_VISION_PROMPT.text },
                { role: 'user', content: imageContent },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        })
        raw = response.choices[0]?.message?.content ?? ''
        logger.info(
            { batchIndex, pages: imageBuffers.length, durationMs: Date.now() - start },
            'demat vision batch complete',
        )
    } catch (e) {
        logger.error({ batchIndex, err: e, durationMs: Date.now() - start }, 'demat vision batch failed')
        return null
    }

    try {
        const parsed = JSON.parse(raw)
        if (parsed.error) {
            logger.warn({ batchIndex, error: parsed.error, reason: parsed.reason }, 'demat vision returned error')
            return null
        }
        return parsed as DematExtraction
    } catch {
        logger.warn({ batchIndex, raw: raw.slice(0, 200) }, 'demat vision response not valid JSON')
        return null
    }
}

function mergeBatchResults(results: (DematExtraction | null)[]): DematExtraction | null {
    const valid = results.filter((r): r is DematExtraction => r !== null)
    if (valid.length === 0) return null

    const base = valid[0]
    const allHoldings = valid.flatMap((r) => r.holdings)
    const allNotes = valid.flatMap((r) => r._extraction_notes ?? [])

    const seen = new Set<string>()
    const holdings = allHoldings.filter((h) => {
        const key = `${h.isin}::${h.company_name.toLowerCase()}`
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

export async function parseDematVision(buffer: Buffer): Promise<DematExtraction | null> {
    let pages: Buffer[]
    try {
        pages = await pdfToImageBuffers(buffer)
    } catch (e) {
        logger.error({ err: e }, 'demat pdf2pic conversion failed')
        return null
    }

    if (pages.length === 0) {
        logger.warn('demat pdf2pic returned 0 pages')
        return null
    }

    const batches = chunk(pages, BATCH_SIZE)
    logger.info({ totalPages: pages.length, batches: batches.length }, 'demat vision: starting batched extraction')

    const batchResults = await Promise.all(
        batches.map((batch, i) => callVisionBatch(batch, i)),
    )

    const failedCount = batchResults.filter((r) => r === null).length
    if (failedCount > 0) {
        logger.warn(
            { failedCount, totalBatches: batches.length },
            'demat vision: some batches failed',
        )
    }
    if (failedCount > batches.length / 2) {
        logger.error(
            { failedCount, totalBatches: batches.length },
            'demat vision: majority of batches failed — aborting to prevent partial portfolio write',
        )
        return null
    }

    return mergeBatchResults(batchResults)
}
