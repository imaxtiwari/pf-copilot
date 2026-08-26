import { inArray, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { fundSnapshots, agentFunds } from '@/db/schema'

export interface DataFreshnessReport {
  stale: string[]
  fresh: string[]
  missing: string[]
}

export interface FreshnessOptions {
  /** Staleness threshold in days (default: 7). */
  thresholdDays?: number
}

/**
 * Check the freshness of NAV snapshots for a set of scheme codes.
 *
 * A scheme is:
 *   - missing  if it has no row in fund_snapshots
 *   - stale    if its latest snapshot is older than thresholdDays
 *   - fresh    otherwise
 */
export async function checkFundDataFreshness(
  schemeCodes: string[],
  options: FreshnessOptions = {},
): Promise<DataFreshnessReport> {
  const report: DataFreshnessReport = {
    stale: [],
    fresh: [],
    missing: [],
  }

  if (schemeCodes.length === 0) {
    return report
  }

  const thresholdDays = options.thresholdDays ?? 7

  // Fetch the latest snapshot date for each requested scheme code.
  const rows = await db
    .select({
      schemeCode: fundSnapshots.schemeCode,
      snapshotDate: fundSnapshots.snapshotDate,
    })
    .from(fundSnapshots)
    .where(inArray(fundSnapshots.schemeCode, schemeCodes))
    .orderBy(desc(fundSnapshots.snapshotDate))

  const latestDates: Record<string, Date> = {}
  for (const row of rows) {
    if (!row.schemeCode || !row.snapshotDate) continue
    const date = new Date(row.snapshotDate)
    if (!latestDates[row.schemeCode] || date > latestDates[row.schemeCode]) {
      latestDates[row.schemeCode] = date
    }
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000)

  for (const code of schemeCodes) {
    const latestDate = latestDates[code]
    if (!latestDate) {
      report.missing.push(code)
    } else if (latestDate < cutoff) {
      report.stale.push(code)
    } else {
      report.fresh.push(code)
    }
  }

  return report
}

/**
 * Identify every active fund in agent_funds that lacks a fresh snapshot.
 * Returns scheme codes only; callers decide whether to refresh or flag.
 */
export async function findAllStaleFunds(thresholdDays = 7): Promise<string[]> {
  const funds = await db
    .select({ schemeCode: agentFunds.schemeCode })
    .from(agentFunds)
    .where(eq(agentFunds.isActive, true))

  const codes = funds.map((f) => f.schemeCode)
  const report = await checkFundDataFreshness(codes, { thresholdDays })
  return [...report.stale, ...report.missing]
}
