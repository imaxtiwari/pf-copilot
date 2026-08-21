import { config } from 'dotenv'
config({ path: '.env.local' })
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import logger from '../lib/logger'
import { randomUUID } from 'crypto'

const MFAPI_BASE = 'https://api.mfapi.in/mf'
const CONCURRENCY = 5           // max parallel scheme fetches
const RETRY_LIMIT = 3           // per scheme, exponential backoff
const RATE_LIMIT_MS = 300       // ms delay between batch starts
const MIN_HISTORY_MONTHS = 36   // only ingest if >= 3 years of NAV data available

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseNavDate(str: string): string {
  const parts = str.split('-')
  if (parts.length !== 3) {
    throw new Error(`Invalid date format from API: ${str}`)
  }
  const day = parts[0].padStart(2, '0')
  const month = parts[1].padStart(2, '0')
  const year = parts[2]
  return `${year}-${month}-${day}`
}

async function fetchWithRetry(url: string, attempt = 1): Promise<any> {
  try {
    const response = await fetch(url)
    
    if (response.status === 429) {
      logger.warn({ url, attempt }, 'Rate limit (429) hit. Waiting 5 seconds...')
      await sleep(5000)
      return fetchWithRetry(url, attempt)
    }

    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    if (attempt >= RETRY_LIMIT) {
      throw error
    }
    const delay = Math.pow(2, attempt - 1) * 1000 // 1000, 2000, 4000 ms
    logger.warn({ url, attempt, delay, error: String(error) }, 'Fetch attempt failed. Retrying...')
    await sleep(delay)
    return fetchWithRetry(url, attempt + 1)
  }
}

async function ingestScheme(schemeCode: string, db: any): Promise<{ inserted: number; skipped: boolean; errored: boolean }> {
  try {
    const url = `${MFAPI_BASE}/${schemeCode}`
    const result = await fetchWithRetry(url)

    if (!result || !result.data || !Array.isArray(result.data)) {
      throw new Error('API returned invalid JSON structure or empty data')
    }

    // Filter: skip entries where nav is "N.A." or non-numeric
    const validData = result.data.filter((item: any) => {
      if (!item.nav || item.nav === 'N.A.') return false
      const numVal = Number(item.nav)
      return !isNaN(numVal)
    })

    // Skip scheme if data.length < MIN_HISTORY_MONTHS * 20
    const minRequired = MIN_HISTORY_MONTHS * 20
    if (validData.length < minRequired) {
      logger.info(
        { schemeCode, count: validData.length, minRequired },
        'Scheme has insufficient history. Skipping.'
      )
      return { inserted: 0, skipped: true, errored: false }
    }

    // Check if the schemeCode exists in agentFunds
    const exists = await db
      .select({ schemeCode: schema.agentFunds.schemeCode })
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.schemeCode, schemeCode))
      .limit(1)

    if (exists.length === 0) {
      logger.info({ schemeCode }, 'Scheme code not present in agentFunds. Skipping DB insert.')
      return { inserted: 0, skipped: true, errored: false }
    }

    const sourceUrl = url
    const retrievedAt = new Date()

    const rowsToInsert = validData.map((item: any) => ({
      snapshotId: randomUUID(),
      schemeCode,
      snapshotDate: parseNavDate(item.date),
      nav: item.nav,
      nav52wHigh: null,
      nav52wLow: null,
      aumCr: null,
      expenseRatio: null,
      return1y: null,
      return3y: null,
      return5y: null,
      return10y: null,
      alpha3y: null,
      sharpe3y: null,
      sortino3y: null,
      maxDrawdown: null,
      sourceUrl,
      retrievedAt,
    }))

    // Batch insert into fundSnapshots in chunks of 200 rows
    let insertedRowsCount = 0
    for (let i = 0; i < rowsToInsert.length; i += 200) {
      const batch = rowsToInsert.slice(i, i + 200)
      const inserted = await db
        .insert(schema.fundSnapshots)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: schema.fundSnapshots.snapshotId })
      insertedRowsCount += inserted.length
    }

    return { inserted: insertedRowsCount, skipped: false, errored: false }
  } catch (error) {
    logger.warn({ schemeCode, error: String(error) }, 'Error processing scheme')
    return { inserted: 0, skipped: false, errored: true }
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    // Parse CLI schemes flag
    const schemesFlagIndex = process.argv.indexOf('--schemes')
    let schemeCodes: string[] = []

    if (schemesFlagIndex !== -1 && process.argv[schemesFlagIndex + 1]) {
      schemeCodes = process.argv[schemesFlagIndex + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      logger.info({ count: schemeCodes.length, schemeCodes }, 'Running ingestion for CLI-specified schemes')
    } else {
      // Query active schemes from agentFunds
      const activeFunds = await db
        .select({ schemeCode: schema.agentFunds.schemeCode })
        .from(schema.agentFunds)
        .where(eq(schema.agentFunds.isActive, true))

      schemeCodes = activeFunds.map((f: any) => f.schemeCode)
      logger.info({ count: schemeCodes.length }, 'Queried active scheme codes from agentFunds')
    }

    let totalProcessed = 0
    let totalInserted = 0
    let totalSkipped = 0
    let totalErrored = 0
    const totalSchemes = schemeCodes.length

    for (let i = 0; i < schemeCodes.length; i += CONCURRENCY) {
      const batch = schemeCodes.slice(i, i + CONCURRENCY)
      
      const results = await Promise.all(
        batch.map((schemeCode) => ingestScheme(schemeCode, db))
      )

      for (const res of results) {
        totalProcessed++
        totalInserted += res.inserted
        if (res.skipped) totalSkipped++
        if (res.errored) totalErrored++

        if (totalProcessed % 50 === 0) {
          logger.info(`[${totalProcessed}/${totalSchemes}] Completed. Inserted ${totalInserted} rows.`)
        }
      }

      if (i + CONCURRENCY < schemeCodes.length) {
        await sleep(RATE_LIMIT_MS)
      }
    }

    logger.info(
      {
        totalProcessed,
        totalInserted,
        totalSkipped,
        totalErrored,
      },
      'Historical NAV Ingestion Completed Summary'
    )
  } catch (err) {
    logger.error({ err: String(err) }, 'Fatal error during NAV ingestion')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((e) => {
    logger.error({ err: String(e) }, 'Fatal error in main wrapper')
    process.exit(1)
  })
}
