import { db } from '../db'
import { fundSnapshots } from '../../db/schema'
import { inArray } from 'drizzle-orm'

export interface DataFreshnessReport {
  stale: string[]
  fresh: string[]
  missing: string[]
}

export async function checkFundDataFreshness(schemeCodes: string[]): Promise<DataFreshnessReport> {
  const report: DataFreshnessReport = {
    stale: [],
    fresh: [],
    missing: []
  }

  if (schemeCodes.length === 0) {
    return report
  }

  // Fetch all snapshots for the given schemeCodes
  const rows = await db
    .select({
      schemeCode: fundSnapshots.schemeCode,
      snapshotDate: fundSnapshots.snapshotDate,
    })
    .from(fundSnapshots)
    .where(inArray(fundSnapshots.schemeCode, schemeCodes))

  // Find the latest snapshot date for each scheme code
  const latestDates: Record<string, Date> = {}
  for (const row of rows) {
    if (!row.schemeCode || !row.snapshotDate) continue
    const date = new Date(row.snapshotDate)
    if (!latestDates[row.schemeCode] || date > latestDates[row.schemeCode]) {
      latestDates[row.schemeCode] = date
    }
  }

  const now = new Date()
  // 7 days in milliseconds
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  for (const code of schemeCodes) {
    const latestDate = latestDates[code]
    if (!latestDate) {
      report.missing.push(code)
    } else if (latestDate < sevenDaysAgo) {
      report.stale.push(code)
    } else {
      report.fresh.push(code)
    }
  }

  return report
}
