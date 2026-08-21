import { describe, it, expect, vi } from 'vitest'
import { runBacktest } from '../../lib/agents/priya-backtest'
import * as schema from '../../db/schema'
import { FundAllocation } from '../../lib/agents/types/priya-types'

// Setup helper to create mock database connection using sequential query resolution
function createMockDb(options: {
  benchFundCode?: string
  counts: Record<string, number>
  snapshots: Record<string, { date: string; nav: number }[]>
}) {
  const selectMock = vi.fn()
  const fromMock = vi.fn()
  const whereMock = vi.fn()
  const orderByMock = vi.fn()
  const limitMock = vi.fn()

  let countCalls = 0
  let snapshotCalls = 0

  const builder = {
    select: selectMock,
    from: fromMock,
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
    then: (resolve: any) => {
      const lastFrom = fromMock.mock.calls[fromMock.mock.calls.length - 1]?.[0]

      if (lastFrom === schema.agentFunds) {
        resolve([{ schemeCode: options.benchFundCode || '151165' }])
        return
      }

      if (lastFrom === schema.fundSnapshots) {
        // Count query does not chain orderBy, snapshots query does chain orderBy
        const isCount = orderByMock.mock.calls.length === 0

        if (isCount) {
          const idx = countCalls++
          const count = idx === 0 ? (options.counts['120001'] ?? 120) : 120
          resolve([{ count }])
          return
        }

        const idx = snapshotCalls++
        if (idx === 0) {
          const substituted = (options.counts['120001'] ?? 120) < 60
          const code = substituted ? '151165' : '120001'
          resolve(options.snapshots[code] || [])
        } else {
          resolve(options.snapshots['151165'] || [])
        }
        return
      }

      resolve([])
    }
  }

  selectMock.mockReturnValue(builder)
  fromMock.mockReturnValue(builder)
  whereMock.mockReturnValue(builder)
  orderByMock.mockReturnValue(builder)
  limitMock.mockReturnValue(builder)

  return builder
}

describe('Backtesting Engine Unit Tests', () => {
  const allocations: FundAllocation[] = [
    {
      allocation_id: '00000000-0000-4000-8000-000000000003',
      fund_name: 'Mock Equity Fund',
      isin: 'INF000000001',
      scheme_code: '120001',
      allocation_pct: 100,
      goal_bucket_id: '00000000-0000-4000-8000-000000000004',
      rationale: 'Core fund selection',
      fund_profile_retrieved_at: new Date().toISOString(),
      overlap_checked: true
    }
  ]

  it('should verify CAGR calculation matches expected value for a known NAV series', async () => {
    // 13 monthly data points representing 1 year. Nav grows from 100 to 112 (12% CAGR)
    const snapshots = [
      { date: '2025-01-31', nav: 100 },
      { date: '2025-02-28', nav: 101 },
      { date: '2025-03-31', nav: 102 },
      { date: '2025-04-30', nav: 103 },
      { date: '2025-05-31', nav: 104 },
      { date: '2025-06-30', nav: 105 },
      { date: '2025-07-31', nav: 106 },
      { date: '2025-08-31', nav: 107 },
      { date: '2025-09-30', nav: 108 },
      { date: '2025-10-31', nav: 109 },
      { date: '2025-11-30', nav: 110 },
      { date: '2025-12-31', nav: 111 },
      { date: '2026-01-31', nav: 112 }
    ]

    const db = createMockDb({
      benchFundCode: '151165',
      counts: { '120001': 120, '151165': 120 },
      snapshots: {
        '120001': snapshots,
        '151165': snapshots
      }
    })

    const result = await runBacktest(allocations, db)
    expect(result.portfolio_cagr_pct).toBeCloseTo(12.0, 1)
    expect(result.benchmark_cagr_pct).toBeCloseTo(12.0, 1)
    expect(result.alpha_pct).toBeCloseTo(0.0, 1)
  })

  it('should verify max drawdown calculation on a series that drops then recovers', async () => {
    // NAV: 100 -> 90 -> 80 (drawdown = 20%) -> 95 -> 105 (recovered)
    const snapshots = [
      { date: '2025-01-31', nav: 100 },
      { date: '2025-02-28', nav: 90 },
      { date: '2025-03-31', nav: 80 },
      { date: '2025-04-30', nav: 95 },
      { date: '2025-05-31', nav: 105 }
    ]

    const db = createMockDb({
      benchFundCode: '151165',
      counts: { '120001': 120, '151165': 120 },
      snapshots: {
        '120001': snapshots,
        '151165': snapshots
      }
    })

    const result = await runBacktest(allocations, db)
    expect(result.max_drawdown_pct).toBeCloseTo(-20.0, 1)
  })

  it('should trigger proxy fund substitution when historical data is less than 5 years (60 points)', async () => {
    const snapshots = [
      { date: '2025-01-31', nav: 100 },
      { date: '2025-02-28', nav: 101 },
      { date: '2025-03-31', nav: 102 }
    ]

    const db = createMockDb({
      benchFundCode: '151165',
      counts: { '120001': 10, '151165': 120 },
      snapshots: {
        '120001': snapshots,
        '151165': snapshots
      }
    })

    const result = await runBacktest(allocations, db)
    expect(result.proxy_funds_used).toHaveLength(1)
    expect(result.proxy_funds_used[0].original).toBe('120001')
    expect(result.proxy_funds_used[0].proxy).toBe('151165')
    expect(result.proxy_funds_used[0].reason).toMatch(/substituted/i)
  })

  it('should verify data_completeness_pct is correctly returned', async () => {
    // Generate 36 unique months spanning 3 years (36 / 120 months = 30%)
    const snapshots = Array.from({ length: 36 }).map((_, idx) => {
      const year = 2021 + Math.floor(idx / 12)
      const month = String((idx % 12) + 1).padStart(2, '0')
      return {
        date: `${year}-${month}-28`,
        nav: 100 + idx
      }
    })

    const db = createMockDb({
      benchFundCode: '151165',
      counts: { '120001': 120, '151165': 120 },
      snapshots: {
        '120001': snapshots,
        '151165': snapshots
      }
    })

    const result = await runBacktest(allocations, db)
    expect(result.data_completeness_pct).toBeCloseTo(30.0, 1)
  })
})
