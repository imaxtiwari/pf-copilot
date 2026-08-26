import { describe, it, expect, vi } from 'vitest'
import { checkFundDataFreshness, findAllStaleFunds } from '@/lib/agents/soma-data-checker'

vi.mock('@/lib/db', () => ({
  db: {},
}))

import { db } from '@/lib/db'

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  return chain
}

describe('checkFundDataFreshness', () => {
  it('classifies fresh, stale, and missing snapshots', async () => {
    const today = new Date().toISOString().split('T')[0]
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    Object.assign(db, {
      select: () => makeSelectChain([
        { schemeCode: 'FRESH001', snapshotDate: today },
        { schemeCode: 'STALE001', snapshotDate: tenDaysAgo },
      ]),
    })

    const report = await checkFundDataFreshness(['FRESH001', 'STALE001', 'MISSING001'])

    expect(report.fresh).toContain('FRESH001')
    expect(report.stale).toContain('STALE001')
    expect(report.missing).toContain('MISSING001')
  })

  it('respects a custom threshold', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    Object.assign(db, {
      select: () => makeSelectChain([{ schemeCode: 'OLD001', snapshotDate: twoDaysAgo }]),
    })

    const report = await checkFundDataFreshness(['OLD001'], { thresholdDays: 1 })
    expect(report.stale).toContain('OLD001')

    const report2 = await checkFundDataFreshness(['OLD001'], { thresholdDays: 3 })
    expect(report2.fresh).toContain('OLD001')
  })

  it('returns empty report for empty input', async () => {
    const report = await checkFundDataFreshness([])
    expect(report).toEqual({ stale: [], fresh: [], missing: [] })
  })
})

describe('findAllStaleFunds', () => {
  it('returns stale and missing scheme codes across active funds', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    let callCount = 0
    Object.assign(db, {
      select: () => {
        callCount++
        if (callCount === 1) {
          return makeSelectChain([{ schemeCode: 'FUND001' }, { schemeCode: 'FUND002' }])
        }
        return makeSelectChain([{ schemeCode: 'FUND001', snapshotDate: tenDaysAgo }])
      },
    })

    const stale = await findAllStaleFunds()
    expect(stale).toContain('FUND001')
    expect(stale).toContain('FUND002')
  })
})
