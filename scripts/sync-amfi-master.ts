import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { getAmfiUrl } from '../lib/factsheets/fetch'
import logger from '../lib/logger'

const BATCH_SIZE = 200

type SchemeRow = {
  schemeCode: string
  isin: string | null
  schemeName: string
  amcName: string
  schemeType: string
  nav: string | null
  navDate: string | null
}

export function mapAmfiCategoryToSchemeType(schemeTypeStr: string, schemeName: string): string {
  const normalizedCategory = schemeTypeStr.toLowerCase()
  const normalizedName = schemeName.toLowerCase()

  // 1. ETF
  if (
    normalizedCategory.includes('etf') ||
    normalizedName.includes(' etf') ||
    normalizedName.includes('-etf') ||
    normalizedName.includes('etf ') ||
    normalizedName.endsWith('etf')
  ) {
    return 'etf'
  }

  // 2. Index
  if (normalizedCategory.includes('index') || normalizedName.includes('index')) {
    return 'index'
  }

  // 3. FoF
  if (
    normalizedCategory.includes('fund of funds') ||
    normalizedCategory.includes('fof') ||
    normalizedName.includes('fof') ||
    normalizedName.includes('fund of funds')
  ) {
    return 'fof'
  }

  // 4. Solution Oriented
  if (normalizedCategory.includes('solution oriented')) {
    return 'solution-oriented'
  }

  // 5. Hybrid
  if (normalizedCategory.includes('hybrid') || normalizedCategory.includes('balanced')) {
    return 'hybrid'
  }

  // 6. Equity
  if (normalizedCategory.includes('equity')) {
    return 'equity'
  }

  // 7. Debt
  if (
    normalizedCategory.includes('debt') ||
    normalizedCategory.includes('liquid') ||
    normalizedCategory.includes('gilt') ||
    normalizedCategory.includes('money market') ||
    normalizedCategory.includes('treasury') ||
    normalizedCategory.includes('floater') ||
    normalizedCategory.includes('short duration') ||
    normalizedCategory.includes('medium duration') ||
    normalizedCategory.includes('long duration')
  ) {
    return 'debt'
  }

  // Default fallback based on name or category
  if (normalizedName.includes('equity')) return 'equity'
  if (
    normalizedName.includes('debt') ||
    normalizedName.includes('liquid') ||
    normalizedName.includes('gilt')
  ) {
    return 'debt'
  }
  if (normalizedName.includes('hybrid')) return 'hybrid'

  return 'equity' // fallback
}

export function parseAmfiDate(dateStr: string): string | null {
  if (!dateStr) return null
  const parts = dateStr.trim().split('-')
  if (parts.length !== 3) return null
  const day = parts[0].padStart(2, '0')
  const monthStr = parts[1].toLowerCase()
  const year = parts[2]

  const months: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  }

  const month = months[monthStr]
  if (!month) return null
  return `${year}-${month}-${day}`
}

function parseAmfiFile(text: string): SchemeRow[] {
  const rows: SchemeRow[] = []
  let currentAmc = 'Unknown'
  let currentType = 'Unknown'

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // Data row: starts with 5-6 digit scheme code followed by semicolon
    if (/^\d{5,6};/.test(line)) {
      const parts = line.split(';')
      if (parts.length < 4) continue
      const schemeCode = parts[0].trim()
      const isin1 = parts[1]?.trim()
      const isin2 = parts[2]?.trim()
      const isin = isin1 && isin1 !== '-' ? isin1 : isin2 && isin2 !== '-' ? isin2 : null
      const schemeName = parts[3].trim()
      const nav = parts[4]?.trim() || null
      const navDate = parts[5]?.trim() || null

      if (!schemeCode || !schemeName || schemeName === 'Scheme Name') continue
      rows.push({
        schemeCode,
        isin,
        schemeName,
        amcName: currentAmc,
        schemeType: currentType,
        nav,
        navDate,
      })
      continue
    }

    if (line.startsWith('Scheme Code;')) continue

    // Category/type header lines
    if (/open\s+ended|close\s+ended|interval\s+fund/i.test(line)) {
      currentType = line.replace(/\(/, ' - ').replace(/\)/, '').replace(/\s{2,}/g, ' ').trim()
      continue
    }

    // AMC name lines: short, no semicolons, not digits
    if (line.length >= 5 && line.length <= 120 && !line.includes(';') && !/^\d/.test(line)) {
      currentAmc = line
    }
  }

  // Deduplicate by schemeCode — last writer wins
  const seen = new Map<string, SchemeRow>()
  for (const row of rows) seen.set(row.schemeCode, row)
  return Array.from(seen.values())
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  const url = getAmfiUrl()
  logger.info({ url }, 'sync-amfi: fetching NAV file')

  const res = await fetch(url)
  if (!res.ok) {
    logger.error({ status: res.status, url }, 'sync-amfi: HTTP error')
    await pool.end()
    process.exit(1)
  }
  const text = await res.text()
  logger.info({ bytes: text.length }, 'sync-amfi: file fetched, parsing')

  const rows = parseAmfiFile(text)
  if (rows.length === 0) {
    logger.error('sync-amfi: no rows parsed — aborting')
    await pool.end()
    process.exit(1)
  }
  logger.info({ count: rows.length }, 'sync-amfi: parsed unique scheme rows')

  const now = new Date()
  let processedMaster = 0
  let processedAgentFunds = 0
  let processedSnapshots = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      // 1. Sync amfi_scheme_master
      await db
        .insert(schema.amfiSchemeMaster)
        .values(
          batch.map((r) => ({
            schemeCode: r.schemeCode,
            schemeName: r.schemeName,
            amcName: r.amcName,
            schemeType: r.schemeType,
            lastSynced: now,
          })),
        )
        .onConflictDoUpdate({
          target: schema.amfiSchemeMaster.schemeCode,
          set: {
            schemeName: sql`excluded.scheme_name`,
            amcName: sql`excluded.amc_name`,
            schemeType: sql`excluded.scheme_type`,
            lastSynced: sql`excluded.last_synced`,
          },
        })
      processedMaster += batch.length

      // 2. Sync agent_funds
      const agentFundsBatch = batch.map((r) => ({
        schemeCode: r.schemeCode,
        isin: r.isin,
        schemeName: r.schemeName,
        amcName: r.amcName,
        schemeType: mapAmfiCategoryToSchemeType(r.schemeType, r.schemeName),
        sebiCategory: r.schemeType,
        sourceUrl: url,
        retrievedAt: now,
        isActive: true,
      }))

      await db
        .insert(schema.agentFunds)
        .values(agentFundsBatch)
        .onConflictDoUpdate({
          target: schema.agentFunds.schemeCode,
          set: {
            isin: sql`excluded.isin`,
            schemeName: sql`excluded.scheme_name`,
            amcName: sql`excluded.amc_name`,
            schemeType: sql`excluded.scheme_type`,
            sebiCategory: sql`excluded.sebi_category`,
            sourceUrl: sql`excluded.source_url`,
            retrievedAt: sql`excluded.retrieved_at`,
            isActive: sql`excluded.is_active`,
          },
        })
      processedAgentFunds += batch.length

      // 3. Sync fund_snapshots (only if valid numeric NAV and date)
      const snapshotsBatch = batch
        .map((r) => {
          const navNum = parseFloat(r.nav || '')
          const formattedDate = r.navDate ? parseAmfiDate(r.navDate) : null
          if (isNaN(navNum) || !formattedDate) return null
          return {
            schemeCode: r.schemeCode,
            snapshotDate: formattedDate,
            nav: navNum.toString(),
            sourceUrl: url,
            retrievedAt: now,
          }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)

      if (snapshotsBatch.length > 0) {
        await db.insert(schema.fundSnapshots).values(snapshotsBatch).onConflictDoNothing()
        processedSnapshots += snapshotsBatch.length
      }
    } catch (e) {
      const cause = (e as { cause?: { message?: string } })?.cause
      logger.error(
        { batchStart: i, cause: cause?.message ?? String(e) },
        'sync-amfi: batch failed',
      )
      failed += batch.length
    }

    if (i > 0 && i % 2000 === 0) {
      logger.info(
        {
          processedMaster,
          processedAgentFunds,
          processedSnapshots,
          failed,
          total: rows.length,
        },
        'sync-amfi: progress',
      )
    }
  }

  logger.info({ processedMaster, processedAgentFunds, processedSnapshots, failed }, 'sync-amfi: complete')
  await pool.end()
}

if (require.main === module) {
  main().catch((e) => {
    logger.error({ err: String(e) }, 'sync-amfi: fatal error')
    process.exit(1)
  })
}
