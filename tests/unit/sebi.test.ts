import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sebi, REQUIRED_DISCLAIMER } from '@/lib/agents/sebi'
import { getGpt4o } from '@/lib/azure-openai'

vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'
const USER_ID = 'u0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'

function makeMockDb() {
  return {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })) })),
  }
}

function makePortfolioDraft(overrides: Partial<any> = {}): any {
  return {
    client_id: CLIENT_ID,
    fund_allocations: [
      { fund_name: 'Equity Fund A', scheme_code: 'FUND001', allocation_pct: 60, sebi_category: 'Equity Scheme - Large Cap' },
      { fund_name: 'Debt Fund B', scheme_code: 'FUND002', allocation_pct: 40, sebi_category: 'Debt Scheme - Corporate Bond' },
    ],
    ...overrides,
  }
}

function makeHolding(overrides: Partial<any> = {}): any {
  return {
    schemeName: 'Equity Fund A',
    schemeType: 'Equity',
    sebiCategory: 'Equity Scheme - Large Cap',
    marketValue: '100000',
    costValue: '80000',
    holdingMonths: '24',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<any> = {}): any {
  return {
    scheme_code: 'FUND001',
    ...overrides,
  }
}

function gptResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

describe('Sebi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes tax liability for equity LTCG gains above exemption', async () => {
    const db = makeMockDb()
    const sebi = new Sebi(db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              sebiComplianceFlags: [{ rule: 'SEBI circular', issue: 'Diversification', severity: 'INFO', remediation: 'Review.' }],
              switchingStrategy: [],
              overallCompliant: true,
              disclaimer: REQUIRED_DISCLAIMER,
            }),
          ),
        },
      },
    } as any)

    const report = await sebi.runComplianceCheck({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      portfolioDraft: makePortfolioDraft(),
      existingHoldings: [makeHolding({ marketValue: '300000', costValue: '100000', holdingMonths: '24' })],
      userProfile: { age: 35, income: 2000000, taxBracket: 30 },
      fundSnapshots: [makeSnapshot()],
    })

    expect(report.ltcgLiability).toBeGreaterThan(0)
    expect(report.stcgLiability).toBe(0)
    expect(report.overallCompliant).toBe(true)
    expect(report.disclaimer).toBe(REQUIRED_DISCLAIMER)
    expect(db.insert).toHaveBeenCalled()
  })

  it('computes STCG for equity held less than one year', async () => {
    const db = makeMockDb()
    const sebi = new Sebi(db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              sebiComplianceFlags: [],
              switchingStrategy: [],
              overallCompliant: true,
              disclaimer: 'Custom disclaimer text.',
            }),
          ),
        },
      },
    } as any)

    const report = await sebi.runComplianceCheck({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      portfolioDraft: makePortfolioDraft(),
      existingHoldings: [makeHolding({ marketValue: '120000', costValue: '100000', holdingMonths: '6' })],
      userProfile: { age: 35, income: 2000000, taxBracket: 30 },
      fundSnapshots: [makeSnapshot()],
    })

    expect(report.stcgLiability).toBeGreaterThan(0)
    expect(report.disclaimer).toBe('Custom disclaimer text.')
  })

  it('flags non-compliant when a BLOCK severity is present', async () => {
    const db = makeMockDb()
    const sebi = new Sebi(db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              sebiComplianceFlags: [{ rule: 'SEBI', issue: 'Concentration', severity: 'BLOCK', remediation: 'Diversify.' }],
              switchingStrategy: [],
              overallCompliant: true,
              disclaimer: REQUIRED_DISCLAIMER,
            }),
          ),
        },
      },
    } as any)

    const report = await sebi.runComplianceCheck({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      portfolioDraft: makePortfolioDraft(),
      existingHoldings: [],
      userProfile: { age: 35, income: 2000000, taxBracket: 30 },
      fundSnapshots: [],
    })

    expect(report.overallCompliant).toBe(false)
  })

  it('calculates ELSS tax-saving opportunity for high tax bracket', async () => {
    const db = makeMockDb()
    const sebi = new Sebi(db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({})),
        },
      },
    } as any)

    const report = await sebi.runComplianceCheck({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      portfolioDraft: makePortfolioDraft({
        fund_allocations: [
          { fund_name: 'ELSS Tax Saver', scheme_code: 'ELSS001', allocation_pct: 0, sebi_category: 'Equity Scheme - ELSS' },
        ],
      }),
      existingHoldings: [makeHolding({ marketValue: '500000', costValue: '400000', schemeName: 'ELSS Tax Saver', schemeType: 'Equity', sebiCategory: 'Equity Scheme - ELSS' })],
      userProfile: { age: 35, income: 2000000, taxBracket: 30 },
      fundSnapshots: [makeSnapshot({ scheme_code: 'ELSS001' })],
    })

    expect(report.elssGap.applicable).toBe(true)
    expect(report.elssGap.currentElssAllocation).toBe(500000)
    expect(report.taxEfficiencyScore).toBeGreaterThanOrEqual(0)
  })

  it('falls back to required disclaimer when LLM omits it', async () => {
    const db = makeMockDb()
    const sebi = new Sebi(db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({ disclaimer: '' })),
        },
      },
    } as any)

    const report = await sebi.runComplianceCheck({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      portfolioDraft: makePortfolioDraft(),
      existingHoldings: [makeHolding()],
      userProfile: { age: 35, income: 2000000, taxBracket: 30 },
      fundSnapshots: [makeSnapshot()],
    })

    expect(report.disclaimer).toBe(REQUIRED_DISCLAIMER)
  })
})

