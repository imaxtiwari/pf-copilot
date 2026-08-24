import { sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { getAmfiUrl } from '../factsheets/fetch'
import logger from '../logger'
import type { DbClient } from '../db'

const BATCH_SIZE = 200

type SchemeRow = {
  schemeCode: string
  schemeName: string
  amcName: string
  schemeType: string
  amfiCategory: string | null
}

function parseAmfiFile(text: string): SchemeRow[] {
  const rows: SchemeRow[] = []
  let currentAmc = 'Unknown'
  let currentType = 'Unknown'
  let currentAmfiCategory: string | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // Data row: starts with 5-6 digit scheme code followed by semicolon
    if (/^\d{5,6};/.test(line)) {
      const parts = line.split(';')
      if (parts.length < 4) continue
      const schemeCode = parts[0].trim()
      const schemeName = parts[3].trim()
      if (!schemeCode || !schemeName || schemeName === 'Scheme Name') continue
      rows.push({
        schemeCode,
        schemeName,
        amcName: currentAmc,
        schemeType: currentType,
        amfiCategory: currentAmfiCategory,
      })
      continue
    }

    if (line.startsWith('Scheme Code;')) continue

    // Top-level scheme type header lines (e.g. "Open Ended Schemes")
    if (/open\s+ended\s+schemes|close\s+ended\s+schemes|interval\s+fund\s+schemes/i.test(line)) {
      currentType = line.replace(/\(/g, ' - ').replace(/\)/g, '').replace(/\s{2,}/g, ' ').trim()
      currentAmfiCategory = null
      continue
    }

    // AMFI category lines (e.g. "Equity Scheme - Large Cap Fund")
    if (
      /fund$/i.test(line) &&
      !/^Scheme Code|Net Asset/i.test(line) &&
      line.length >= 10 &&
      line.length <= 140
    ) {
      currentAmfiCategory = line.replace(/\s{2,}/g, ' ').trim()
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

export type SyncAmfiResult = {
  processed: number
  failed: number
  total: number
}

/**
 * Fetch the latest AMFI master file and upsert scheme rows.
 * Idempotent: re-running with the same data updates existing rows.
 */
export async function syncAmfiMaster(db: DbClient): Promise<SyncAmfiResult> {
  const url = getAmfiUrl()
  logger.info({ url }, 'sync-amfi: fetching NAV file')

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`sync-amfi: HTTP ${res.status} from ${url}`)
  }

  const text = await res.text()
  logger.info({ bytes: text.length }, 'sync-amfi: file fetched, parsing')

  const rows = parseAmfiFile(text)
  if (rows.length === 0) {
    throw new Error('sync-amfi: no rows parsed')
  }
  logger.info({ count: rows.length }, 'sync-amfi: parsed unique scheme rows')

  const now = new Date()
  let processed = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      await db
        .insert(schema.amfiSchemeMaster)
        .values(batch.map((r) => ({ ...r, lastSynced: now })))
        .onConflictDoUpdate({
          target: schema.amfiSchemeMaster.schemeCode,
          set: {
            schemeName: sql`excluded.scheme_name`,
            amcName: sql`excluded.amc_name`,
            schemeType: sql`excluded.scheme_type`,
            amfiCategory: sql`excluded.amfi_category`,
            lastSynced: sql`excluded.last_synced`,
          },
        })
      processed += batch.length
    } catch (e) {
      const cause = (e as { cause?: { message?: string } })?.cause
      logger.error({ batchStart: i, cause: cause?.message ?? String(e) }, 'sync-amfi: batch failed')
      failed += batch.length
    }

    if (i > 0 && i % 2000 === 0) {
      logger.info({ processed, failed, total: rows.length }, 'sync-amfi: progress')
    }
  }

  logger.info({ processed, failed }, 'sync-amfi: complete')
  return { processed, failed, total: rows.length }
}
