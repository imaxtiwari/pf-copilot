import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFindFirst = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  db: {
    select: mockDbSelect,
    query: {
      userProfile: { findFirst: () => mockFindFirst() },
      portfolioHoldings: { findFirst: () => mockFindFirst() },
    },
  },
}))

vi.mock('@/db/schema', () => ({
  portfolioHoldings: { __table: 'portfolioHoldings' },
  amfiSchemeMaster: { __table: 'amfiSchemeMaster' },
  userProfile: { __table: 'userProfile' },
  factsheetChunks: { __table: 'factsheetChunks' },
  chatMessages: { __table: 'chatMessages' },
}))

import { getPortfolio } from '@/lib/tools/get-portfolio'
import { computePersonalInflationTool } from '@/lib/tools/compute-inflation'
import { computeRealReturns } from '@/lib/tools/compute-real-returns'
import { lookupChatHistory } from '@/lib/tools/lookup-chat-history'

function createDbChain(tableResults: Record<string, unknown>) {
  return {
    from: (table: { __table?: string }) => {
      const result = table?.__table ? tableResults[table.__table] ?? [] : []
      const needsLimit = table?.__table === 'factsheetChunks' || table?.__table === 'chatMessages'
      return {
        where: () => ({
          orderBy: needsLimit
            ? () => ({ limit: () => Promise.resolve(result) })
            : () => Promise.resolve(result),
        }),
      }
    },
  }
}

function portfolioSelectChain(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(result),
      }),
    }),
  }
}

function amfiSelectChain(result: unknown) {
  return {
    from: () => ({
      where: () => Promise.resolve(result),
    }),
  }
}

describe('getPortfolio', () => {
  beforeEach(() => {
    mockDbSelect.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns holdings and asset mix for a user', async () => {
    const holding = {
      schemeName: 'Nifty 50 Index Fund',
      schemeCode: '120503',
      marketValue: '250000',
      units: '100',
      nav: '2500',
      asOfDate: '2026-07-26',
    }
    mockDbSelect
      .mockImplementationOnce(() => portfolioSelectChain([holding]))
      .mockImplementationOnce(() => amfiSelectChain([{ schemeCode: '120503', schemeType: 'Equity' }]))

    const result = await getPortfolio('user-1')
    expect(result.holdings).toHaveLength(1)
    expect(result.total_value).toBe(250000)
    expect(result.truncated).toBeNull()
    expect(result.asset_mix).toEqual({ Equity: 100 })
  })

  it('truncates holdings above the cap', async () => {
    const holdings = Array.from({ length: 35 }, (_, i) => ({
      schemeName: `Fund ${i}`,
      schemeCode: String(i),
      marketValue: String(1000),
      units: '10',
      nav: '100',
      asOfDate: '2026-07-26',
    }))
    mockDbSelect
      .mockImplementationOnce(() => portfolioSelectChain(holdings))
      .mockImplementationOnce(() => amfiSelectChain([]))

    const result = await getPortfolio('user-1')
    expect(result.holdings).toHaveLength(30)
    expect(result.truncated?.count).toBe(5)
  })
})

describe('computePersonalInflationTool', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
  })

  it('falls back when no profile exists', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await computePersonalInflationTool('user-1')
    expect(result.inflation_rate).toBeDefined()
    expect(result.note).toContain('No onboarding profile')
  })

  it('serves cached rate when available', async () => {
    mockFindFirst.mockResolvedValue({
      inflationRate: '6.5',
      inflationConfidence: 'high',
      inflationBreakdown: [],
      computedAt: new Date(),
    })
    const result = await computePersonalInflationTool('user-1')
    expect(result.inflation_rate).toBe(6.5)
    expect(result.computed_at).toBeDefined()
  })

  it('warns and notes stale cached rates', async () => {
    const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    mockFindFirst.mockResolvedValue({
      inflationRate: '6.5',
      inflationConfidence: 'high',
      inflationBreakdown: [],
      computedAt: stale,
    })
    const result = await computePersonalInflationTool('user-1')
    expect(result.note).toContain('90 days')
  })
})

describe('computeRealReturns', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
    mockDbSelect.mockReset()
  })

  it('returns full result when holding and factsheet data exist', async () => {
    let calls = 0
    mockFindFirst.mockImplementation(() => {
      calls++
      if (calls === 1) return Promise.resolve({ inflationRate: '6.5', inflationConfidence: 'high' })
      return Promise.resolve({
        schemeName: 'Nifty 50 Index Fund',
        units: '100',
        nav: '2500',
        marketValue: '250000',
        asOfDate: '2026-07-26',
      })
    })
    mockDbSelect.mockReturnValue(createDbChain({
      factsheetChunks: [{ chunkText: '1Y: 12.5%', factsheetDate: '2026-07-01', schemeName: 'Nifty 50 Index Fund' }],
    }))

    const result = await computeRealReturns('120503', 'user-1')
    expect(result.coverage_ratio).toBe(1)
    expect(result.personal_inflation_rate).toBe(6.5)
    expect(result.factsheet_returns_data).toContain('12.5%')
  })

  it('notes missing onboarding when no inflation rate', async () => {
    mockFindFirst.mockResolvedValue(null)
    mockDbSelect.mockReturnValue(createDbChain({ factsheetChunks: [] }))

    const result = await computeRealReturns('120503', 'user-1')
    expect(result.note).toContain('onboarding')
    expect(result.coverage_ratio).toBe(0)
  })
})

describe('lookupChatHistory', () => {
  beforeEach(() => {
    mockDbSelect.mockReset()
  })

  it('returns chronological user/assistant turns', async () => {
    mockDbSelect.mockReturnValue(createDbChain({
      chatMessages: [
        { role: 'assistant', content: 'Answer', ts: new Date('2026-01-02') },
        { role: 'user', content: 'Question', ts: new Date('2026-01-01') },
        { role: 'system', content: 'ignored', ts: new Date('2026-01-01') },
      ],
    }))

    const result = await lookupChatHistory('user-1')
    expect(result.count).toBe(2)
    expect(result.turns[0].role).toBe('user')
    expect(result.turns[1].role).toBe('assistant')
  })
})