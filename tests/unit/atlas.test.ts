import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Atlas } from '@/lib/agents/atlas'
import { getGpt4oMini } from '@/lib/azure-openai'

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'
const USER_ID = 'u0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'

function makeMockDb() {
  return {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })) })),
  }
}

function makeApprovedPortfolio(overrides: Partial<any> = {}): any {
  return {
    client_id: CLIENT_ID,
    fund_allocations: [
      { scheme_code: 'FUND001', fund_name: 'Equity Fund A', allocation_pct: 60, expense_ratio: 1.0, return_3yr: 12 },
      { scheme_code: 'FUND002', fund_name: 'Debt Fund B', allocation_pct: 40, expense_ratio: 0.5, return_3yr: 7 },
    ],
    ...overrides,
  }
}

function makeHolding(overrides: Partial<any> = {}): any {
  return {
    schemeCode: 'FUND001',
    schemeName: 'Equity Fund A',
    marketValue: '60000',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<any> = {}): any {
  return {
    schemeCode: 'FUND001',
    expenseRatio: 1.0,
    return3yr: 12,
    ...overrides,
  }
}

function gptResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

describe('Atlas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a comparison report with overlap analysis', async () => {
    const db = makeMockDb()
    const atlas = new Atlas(db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              consolidationInsight: 'Strong overlap discussion.',
              switchingCost: { recommendedSwitchOrder: ['Debt Fund B'] },
              topInsights: ['Insight one.', 'Insight two.', 'Insight three.'],
            }),
          ),
        },
      },
    } as any)

    const existing = [makeHolding(), makeHolding({ schemeCode: 'FUND002', schemeName: 'Debt Fund B', marketValue: '40000' })]
    const approved = makeApprovedPortfolio()
    const report = await atlas.generateReport(USER_ID, RUN_ID, approved, existing, [makeSnapshot(), makeSnapshot({ schemeCode: 'FUND002' })])

    expect(report.overlapAnalysis.overlapPercentage).toBe(100)
    expect(report.overlapAnalysis.sharedFunds).toContain('Equity Fund A')
    expect(report.costAnalysis.currentWeightedExpenseRatio).toBeGreaterThan(0)
    expect(report.consolidationInsight).toBe('Strong overlap discussion.')
    expect(db.insert).toHaveBeenCalled()
  })

  it('identifies new funds when existing holdings are empty', async () => {
    const db = makeMockDb()
    const atlas = new Atlas(db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              consolidationInsight: 'All recommended funds are new for discussion.',
              switchingCost: { recommendedSwitchOrder: [] },
              topInsights: ['A', 'B', 'C'],
            }),
          ),
        },
      },
    } as any)

    const approved = makeApprovedPortfolio()
    const report = await atlas.generateReport(USER_ID, RUN_ID, approved, [], [makeSnapshot(), makeSnapshot({ schemeCode: 'FUND002' })])

    expect(report.overlapAnalysis.overlapPercentage).toBe(0)
    expect(report.overlapAnalysis.newFunds).toContain('Equity Fund A')
    expect(report.overlapAnalysis.exitFunds).toHaveLength(0)
  })

  it('uses fallback values when the LLM returns empty JSON', async () => {
    const db = makeMockDb()
    const atlas = new Atlas(db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({})),
        },
      },
    } as any)

    const existing = [makeHolding(), makeHolding({ schemeCode: 'FUND002', schemeName: 'Debt Fund B', marketValue: '40000' })]
    const approved = makeApprovedPortfolio()
    const report = await atlas.generateReport(USER_ID, RUN_ID, approved, existing, [makeSnapshot()])

    expect(report.consolidationInsight).toContain('overlap')
    expect(report.switchingCost.recommendedSwitchOrder).toBeDefined()
    expect(report.topInsights).toHaveLength(3)
  })

  it('handles zero total current value gracefully', async () => {
    const db = makeMockDb()
    const atlas = new Atlas(db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({})),
        },
      },
    } as any)

    const existing = [makeHolding({ marketValue: '0' })]
    const approved = makeApprovedPortfolio()
    const report = await atlas.generateReport(USER_ID, RUN_ID, approved, existing, [makeSnapshot()])

    expect(report.overlapAnalysis.overlapPercentage).toBe(0)
    expect(report.returnAnalysis.currentPortfolio3YrReturn).toBe(0)
  })
})
