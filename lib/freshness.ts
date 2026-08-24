/**
 * Data freshness utilities.
 *
 * Default freshness tolerance is 7 days for factsheets/documents and
 * 1 day for portfolio snapshots (NAV-based market values move daily).
 * Callers can override `freshnessDays` per row.
 */

export type FreshnessRecord = {
  lastSyncedAt?: Date | string | null
  freshnessDays?: number | null
  isStale?: boolean | null
}

export const DEFAULT_FACTSHEET_FRESHNESS_DAYS = 7
export const DEFAULT_PORTFOLIO_FRESHNESS_DAYS = 1
export const DEFAULT_STOCK_DOCUMENT_FRESHNESS_DAYS = 7

/**
 * Return true if a record is stale or has no freshness metadata.
 */
export function isStale(record: FreshnessRecord, nowMs: number = Date.now()): boolean {
  if (record.isStale) return true
  if (!record.lastSyncedAt) return true

  const freshnessDays = record.freshnessDays ?? DEFAULT_FACTSHEET_FRESHNESS_DAYS
  const lastSyncedMs = new Date(record.lastSyncedAt).getTime()
  if (Number.isNaN(lastSyncedMs)) return true

  const ageMs = nowMs - lastSyncedMs
  const thresholdMs = freshnessDays * 24 * 60 * 60 * 1000
  return ageMs > thresholdMs
}

/**
 * Human-readable age string, e.g. "2 days old".
 */
export function formatAge(record: FreshnessRecord, nowMs: number = Date.now()): string {
  if (!record.lastSyncedAt) return 'never synced'
  const lastSyncedMs = new Date(record.lastSyncedAt).getTime()
  if (Number.isNaN(lastSyncedMs)) return 'unknown age'
  const days = Math.floor((nowMs - lastSyncedMs) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return '1 day old'
  return `${days} days old`
}

export type FreshnessSummary = {
  isStale: boolean
  ageText: string
  freshnessDays: number
}

export function summarizeFreshness(
  record: FreshnessRecord,
  defaultDays: number,
  nowMs: number = Date.now(),
): FreshnessSummary {
  const freshnessDays = record.freshnessDays ?? defaultDays
  return {
    isStale: isStale({ ...record, freshnessDays }, nowMs),
    ageText: formatAge(record, nowMs),
    freshnessDays,
  }
}
