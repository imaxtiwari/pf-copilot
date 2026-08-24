import { describe, it, expect } from 'vitest'
import {
  isStale,
  formatAge,
  summarizeFreshness,
  DEFAULT_FACTSHEET_FRESHNESS_DAYS,
} from '@/lib/freshness'

describe('freshness', () => {
  it('marks a record stale when lastSyncedAt is missing', () => {
    expect(isStale({})).toBe(true)
  })

  it('marks a record stale when isStale is explicitly true', () => {
    expect(isStale({ lastSyncedAt: new Date(), isStale: true })).toBe(true)
  })

  it('marks a record fresh within the default window', () => {
    const lastSyncedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(isStale({ lastSyncedAt })).toBe(false)
  })

  it('marks a record stale beyond the default window', () => {
    const lastSyncedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    expect(isStale({ lastSyncedAt })).toBe(true)
  })

  it('respects a custom freshnessDays override', () => {
    const lastSyncedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(isStale({ lastSyncedAt, freshnessDays: 1 })).toBe(true)
    expect(isStale({ lastSyncedAt, freshnessDays: 3 })).toBe(false)
  })

  it('handles string lastSyncedAt values', () => {
    const lastSyncedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    expect(isStale({ lastSyncedAt })).toBe(true)
  })

  it('formats age text correctly', () => {
    expect(formatAge({ lastSyncedAt: new Date() })).toBe('today')
    expect(formatAge({ lastSyncedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })).toBe('1 day old')
    expect(formatAge({})).toBe('never synced')
  })

  it('summarizes freshness with custom defaults', () => {
    const lastSyncedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const summary = summarizeFreshness({ lastSyncedAt }, DEFAULT_FACTSHEET_FRESHNESS_DAYS)
    expect(summary.isStale).toBe(false)
    expect(summary.ageText).toBe('2 days old')
    expect(summary.freshnessDays).toBe(DEFAULT_FACTSHEET_FRESHNESS_DAYS)
  })
})
