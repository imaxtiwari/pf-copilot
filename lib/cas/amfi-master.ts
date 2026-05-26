import { db } from '../db'
import { amfiSchemeMaster } from '../../db/schema'
import { sql } from 'drizzle-orm'
import logger from '../logger'

export type SchemeCheckResult = {
  matched: string[]
  unmatched: string[]
}

export async function crossCheckSchemes(
  schemeNames: string[],
): Promise<SchemeCheckResult> {
  if (schemeNames.length === 0) return { matched: [], unmatched: [] }

  // Build one OR query across all scheme names
  // Each name uses a LIKE match on the first 30 characters (same heuristic as before)
  const truncated = schemeNames.map((n) => n.slice(0, 30).toLowerCase())

  let rows: { schemeName: string }[] = []
  try {
    // Use ANY(ARRAY[...]) for a single-query batch ILIKE check
    rows = await db
      .select({ schemeName: amfiSchemeMaster.schemeName })
      .from(amfiSchemeMaster)
      .where(
        sql`lower(${amfiSchemeMaster.schemeName}) LIKE ANY(
          ARRAY[${sql.join(truncated.map((t) => sql`${'%' + t + '%'}`), sql`, `)}]
        )`,
      )
  } catch (e) {
    logger.warn({ err: e }, 'amfi scheme batch lookup failed — treating all as unmatched')
    return { matched: schemeNames, unmatched: [] }  // fail-open: don't reject valid holdings
  }

  // For each input name, check if any returned DB name contains it (substring match)
  const dbNames = rows.map((r) => r.schemeName.toLowerCase())
  const matched: string[] = []
  const unmatched: string[] = []
  for (const name of schemeNames) {
    const needle = name.slice(0, 30).toLowerCase()
    const found = dbNames.some((dbName) => dbName.includes(needle))
    if (found) {
      matched.push(name)
    } else {
      unmatched.push(name)
    }
  }

  return { matched, unmatched }
}
