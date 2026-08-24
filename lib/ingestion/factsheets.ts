import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFParse } from 'pdf-parse'
import * as schema from '../../db/schema'
import { fetchLatestFactsheet, buildFactsheetUrl } from '../factsheets/fetch'
import { chunkFactsheetText } from '../factsheets/chunk'
import { embedAndInsert } from '../factsheets/embed'
import logger from '../logger'
import type { DbClient } from '../db'

type FactsheetTarget = {
  amc: string
  scheme_code: string
  scheme_name: string
  factsheet_url_pattern: string
}

async function extractText(buffer: Buffer): Promise<string | null> {
  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return result.text
  } catch {
    return null
  }
}

export type IngestFactsheetResult = {
  schemesProcessed: number
  errors: number
}

async function processTarget(target: FactsheetTarget, db: DbClient): Promise<'ok' | 'error'> {
  logger.info({ amc: target.amc, scheme: target.scheme_name }, 'ingest: starting')

  const fetched = await fetchLatestFactsheet(target.factsheet_url_pattern)
  if (!fetched) {
    logger.warn(
      { amc: target.amc, pattern: target.factsheet_url_pattern },
      'ingest: could not fetch factsheet (tried last 3 months)',
    )
    return 'error'
  }

  const { buffer, year, month } = fetched
  const sourceUrl = buildFactsheetUrl(target.factsheet_url_pattern, year, month)
  const factsheetDate = `${year}-${String(month).padStart(2, '0')}-01`

  logger.info({ amc: target.amc, sourceUrl, bytes: buffer.length }, 'ingest: PDF fetched')

  const text = await extractText(buffer)
  if (!text || text.trim().length < 100) {
    logger.warn({ amc: target.amc, sourceUrl }, 'ingest: text extraction failed or empty')
    return 'error'
  }

  const chunks = chunkFactsheetText(text)
  if (chunks.length === 0) {
    logger.warn({ amc: target.amc, sourceUrl }, 'ingest: no chunks produced')
    return 'error'
  }

  logger.info({ amc: target.amc, sections: chunks.length }, 'ingest: chunked, embedding')

  const result = await embedAndInsert({
    schemeCode: target.scheme_code,
    schemeName: target.scheme_name,
    sourceUrl,
    factsheetDate,
    chunks,
    db,
    factsheetChunksTable: schema.factsheetChunks,
  })

  logger.info({ amc: target.amc, ...result, sections: chunks.length }, 'ingest: scheme complete')
  return 'ok'
}

/**
 * Ingest factsheets for all configured targets.
 * Idempotent: re-running re-fetches and upserts chunks by unique index.
 */
export async function ingestFactsheets(db: DbClient): Promise<IngestFactsheetResult> {
  const targetsPath = join(process.cwd(), 'scripts', 'factsheet-targets.json')
  const targets: FactsheetTarget[] = JSON.parse(readFileSync(targetsPath, 'utf-8'))

  logger.info({ count: targets.length }, 'ingest: starting')

  let schemesProcessed = 0
  let errors = 0

  for (const target of targets) {
    try {
      const status = await processTarget(target, db)
      if (status === 'ok') schemesProcessed++
      else errors++
    } catch (e) {
      logger.error({ amc: target.amc, err: String(e) }, 'ingest: unhandled error, continuing')
      errors++
    }
  }

  logger.info({ schemesProcessed, errors }, 'ingest: all targets processed')
  return { schemesProcessed, errors }
}
