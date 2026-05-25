import { db } from '../db'
import { amfiSchemeMaster } from '../../db/schema'
import { eq, or, sql } from 'drizzle-orm'
import logger from '../logger'

export type SchemeCheckResult = {
  matched: string[]
  unmatched: string[]
}

export async function crossCheckSchemes(
  schemeNames: string[],
): Promise<SchemeCheckResult> {
  if (schemeNames.length === 0) return { matched: [], unmatched: [] }

  const matched: string[] = []
  const unmatched: string[] = []

  // Check each scheme name against amfi_scheme_master using ILIKE for fuzzy match
  for (const name of schemeNames) {
    try {
      const rows = await db
        .select({ schemeCode: amfiSchemeMaster.schemeCode })
        .from(amfiSchemeMaster)
        .where(sql`lower(${amfiSchemeMaster.schemeName}) like lower(${`%${name.slice(0, 30)}%`})`)
        .limit(1)

      if (rows.length > 0) {
        matched.push(name)
      } else {
        unmatched.push(name)
      }
    } catch (e) {
      logger.warn({ scheme: name, err: e }, 'amfi scheme lookup failed')
      unmatched.push(name)
    }
  }

  return { matched, unmatched }
}

void or // suppress unused import
void eq
