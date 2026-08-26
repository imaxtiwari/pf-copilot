import { describe, it, expect, vi } from 'vitest'
import { runBacktest } from '@/lib/agents/priya-backtest'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

function makeSequenceDb(sequence: unknown[][]) {
  let call = -1
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    and: () => chain,
    like: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown[]) => void) => {
      call++
      resolve(sequence[call] ?? [])
    },
  }
  return { select: () => chain }
}

const allocation = {
  allocation_id: 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11',
  fund_name: 'Test Fund',
  isin: 'IN0000000001',
  scheme_code: 'FUND001',
  allocation_pct: 100,
  goal_bucket_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  rationale: 'Test',
  fund_profile_retrieved_at: new Date().toISOString(),
  overlap_checked: false,
}

function monthlyRows(prefix: string, count: number, startNav: number, growth: number) {
  const rows: { date: string; nav: string }[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const dateStr = d.toISOString().split('T')[0]
    rows.push({ date: dateStr, nav: (startNav * Math.pow(1 + growth, count - 1 - i)).toFixed(4) })
  }
  return rows
}

describe('runBacktest', () => {
  it('returns simulated statistics when data is sparse', async () => {
    const sequence = [[{ schemeCode: 'BENCH' }], [{ count: 0 }], [], []]
    const db = makeSequenceDb(sequence)

    const summary = await runBacktest([allocation as any], db as any)

    expect(summary.proxy_funds_used).toHaveLength(1)
    expect(summary.proxy_funds_used[0].original).toBe('FUND001')
    expect(summary.data_completeness_pct).toBe(0)
    expect(summary.period_years).toBe(5)
  })

  it('computes CAGR and ratios from available snapshots', async () => {
    const fundRows = monthlyRows('FUND001', 12, 100, 0.01)
    const benchRows = monthlyRows('BENCH', 12, 100, 0.008)
    const sequence = [[{ schemeCode: 'BENCH' }], [{ count: 0 }], fundRows, benchRows]
    const db = makeSequenceDb(sequence)

    const summary = await runBacktest([allocation as any], db as any)

    expect(summary.proxy_funds_used).toHaveLength(1)
    expect(summary.data_completeness_pct).toBeGreaterThan(0)
    expect(summary.portfolio_cagr_pct).not.toBeNaN()
    expect(summary.benchmark_cagr_pct).not.toBeNaN()
    expect(summary.scenario_overlay.scenarios).toHaveLength(1)
  })
})
