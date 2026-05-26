import { db } from '../db'
import { amfiSchemeMaster } from '../../db/schema'
import { or, sql } from 'drizzle-orm'
import logger from '../logger'

export type SchemeCheckResult = {
  matched: string[]
  unmatched: string[]
}

export async function crossCheckSchemes(
  schemeNames: string[],
): Promise<SchemeCheckResult> {
  if (schemeNames.length === 0) return { matched: [], unmatched: [] }

  // Single query: OR together one LIKE condition per input name.
  // The application then reverse-maps DB results back to input names — O(n) after one round-trip.
  const conditions = schemeNames.map(
    (name) => sql`lower(${amfiSchemeMaster.schemeName}) like ${`%${name.slice(0, 30).toLowerCase()}%`}`,
  )

  let dbSchemeNames: string[] = []
  try {
    const rows = await db
      .select({ schemeName: amfiSchemeMaster.schemeName })
      .from(amfiSchemeMaster)
      .where(or(...conditions))
    dbSchemeNames = rows.map((r) => r.schemeName.toLowerCase())
  } catch (e) {
    logger.warn({ err: e }, 'amfi crossCheckSchemes batch query failed — marking all as unmatched')
    return { matched: [], unmatched: [...schemeNames] }
  }

  const matched: string[] = []
  const unmatched: string[] = []
  for (const name of schemeNames) {
    const prefix = name.slice(0, 30).toLowerCase()
    if (dbSchemeNames.some((dbName) => dbName.includes(prefix))) {
      matched.push(name)
    } else {
      unmatched.push(name)
    }
  }

  return { matched, unmatched }
}
