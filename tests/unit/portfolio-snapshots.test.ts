import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDbQuery = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())
const mockDbInsert = vi.hoisted(() => vi.fn())
const mockDbExecute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  db: {
    query: { userProfile: { findFirst: mockDbQuery } },
    select: mockDbSelect,
    insert: () => mockDbInsert(),
    execute: mockDbExecute,
  },
}))

vi.mock('@/db/schema', () => ({
  portfolioHoldings: {},
  portfolioSnapshots: { userId: {}, asOfDate: {}, totalValue: {}, realReturnAnnualized: {}, inflationRateUsed: {}, id: {} },
  userProfile: {},
}))

import { getUserInflationRate, buildSnapshots } from '@/lib/portfolio/snapshots'

describe('getUserInflationRate', () => {
  beforeEach(() => {
    mockDbQuery.mockReset()
  })

  it('returns stored rate from profile', async () => {
    mockDbQuery.mockResolvedValue({ inflationRate: '6.5', inflationConfidence: 'high' })
    const result = await getUserInflationRate('user-1')
    expect(result.rate).toBe(6.5)
    expect(result.confidence).toBe('high')
  })

  it('computes fallback rate when profile has no stored rate', async () => {
    mockDbQuery.mockResolvedValue({ age: 35, cityTier: 'metro', monthlyRent: '50000', ownsHome: false })
    const result = await getUserInflationRate('user-1')
    expect(result.rate).toBeGreaterThan(0)
  })
})

describe('buildSnapshots', () => {
  beforeEach(() => {
    mockDbQuery.mockReset()
    mockDbSelect.mockReset()
    mockDbExecute.mockReset()
  })

  it('returns empty array when user has no holdings', async () => {
    mockDbQuery.mockResolvedValue({ inflationRate: '6.5', inflationConfidence: 'high' })
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    })

    const result = await buildSnapshots('user-1')
    expect(result).toEqual([])
  })

  it('builds a snapshot from holdings and factsheet data', async () => {
    mockDbQuery.mockResolvedValue({ inflationRate: '6.5', inflationConfidence: 'high' })
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              { schemeCode: '120503', schemeName: 'Nifty 50', marketValue: '250000', asOfDate: '2026-07-26' },
            ]),
        }),
      }),
    })
    mockDbExecute.mockResolvedValue({
      rows: [{ scheme_code: '120503', chunk_text: '1Y return: 12.5%', factsheet_date: '2026-07-01' }],
    })

    const result = await buildSnapshots('user-1')
    expect(result).toHaveLength(1)
    expect(result[0].asOfDate).toBe('2026-07-26')
    expect(result[0].inflationRateUsed).toBe(6.5)
  })
})