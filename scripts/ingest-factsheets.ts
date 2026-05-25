import { config } from 'dotenv'
config({ path: '.env.local' })

// Pool/db created inside main() — avoids TypeScript import-hoisting problem
// where lib/db.ts pool would be constructed before dotenv runs.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PDFParse } from 'pdf-parse'
import { fetchLatestFactsheet, buildFactsheetUrl } from '../lib/factsheets/fetch'
import { chunkFactsheetText } from '../lib/factsheets/chunk'
import { embedAndInsert } from '../lib/factsheets/embed'
import * as schema from '../db/schema'
import logger from '../lib/logger'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processTarget(target: FactsheetTarget, db: any): Promise<void> {
  logger.info({ amc: target.amc, scheme: target.scheme_name }, 'ingest: starting')

  const fetched = await fetchLatestFactsheet(target.factsheet_url_pattern)
  if (!fetched) {
    logger.warn({ amc: target.amc, pattern: target.factsheet_url_pattern }, 'ingest: could not fetch factsheet (tried last 3 months)')
    return
  }

  const { buffer, year, month } = fetched
  const sourceUrl = buildFactsheetUrl(target.factsheet_url_pattern, year, month)
  const factsheetDate = `${year}-${String(month).padStart(2, '0')}-01`

  logger.info({ amc: target.amc, sourceUrl, bytes: buffer.length }, 'ingest: PDF fetched')

  const text = await extractText(buffer)
  if (!text || text.trim().length < 100) {
    logger.warn({ amc: target.amc, sourceUrl }, 'ingest: text extraction failed or empty')
    return
  }

  const chunks = chunkFactsheetText(text)
  if (chunks.length === 0) {
    logger.warn({ amc: target.amc, sourceUrl }, 'ingest: no chunks produced')
    return
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
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  const targetsPath = join(process.cwd(), 'scripts', 'factsheet-targets.json')
  const targets: FactsheetTarget[] = JSON.parse(readFileSync(targetsPath, 'utf-8'))

  logger.info({ count: targets.length }, 'ingest: starting')

  for (const target of targets) {
    try {
      await processTarget(target, db)
    } catch (e) {
      logger.error({ amc: target.amc, err: String(e) }, 'ingest: unhandled error, continuing')
    }
  }

  logger.info('ingest: all targets processed')
  await pool.end()
}

main().catch((e) => {
  logger.error({ err: String(e) }, 'ingest: fatal error')
  process.exit(1)
})
