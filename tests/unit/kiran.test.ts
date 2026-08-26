import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { Kiran } from '@/lib/agents/kiran'
import { getGpt4oMini } from '@/lib/azure-openai'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/research/knowledge-commons', () => ({
  KnowledgeCommons: class {
    async queryCommons() {
      return []
    }
    async contribute() {}
  },
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
  getGpt4o: vi.fn(),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  return chain
}

function makeMockDb(rows: unknown[] = []) {
  return {
    select: vi.fn(() => makeSelectChain(rows)),
  }
}

function gptResponse(payload: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  }
}

function makeWebTool() {
  return {
    research: vi.fn(async () => [
      {
        url: 'https://rbi.org.in',
        title: 'RBI Update',
        content_snippet: 'Policy unchanged.',
        retrieved_at: new Date().toISOString(),
        confidence_tier: 'VERIFIED',
        memory_id: 'm1',
      },
    ]),
  } as any
}

describe('Kiran', () => {
  const room = new DeliberationRoom()
  const webTool = makeWebTool()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds a HedgeMap with hypothetical risk scenarios', async () => {
    const db = makeMockDb([{ schemeCode: 'FUND001', schemeName: 'Test Equity Fund', schemeType: 'equity' }])
    const kiran = new Kiran(room, webTool, db)

    const hedgeResponse = {
      risk_scenario: 'If equity markets fall 20%, this allocation declines.',
      hedge_instrument: 'Diversified debt allocation',
      hedge_rationale: 'Low correlation to equities',
      contingency_if_hedge_fails: 'Reduce allocation gradually',
    }

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(hedgeResponse)),
        },
      },
    } as any)

    const draft = {
      client_id: CLIENT_ID,
      fund_allocations: [{ fund_name: 'Test Equity Fund', scheme_code: 'FUND001', allocation_pct: 100 }],
    }

    const hedgeMap = await kiran.buildHedgeMap(draft, RUN_ID)

    expect(hedgeMap.positions).toHaveLength(1)
    expect(hedgeMap.positions[0].scheme_code).toBe('FUND001')
    expect(hedgeMap.positions[0].risk_scenario).toContain('If')
    expect(hedgeMap.overall_hedge_coverage_pct).toBeGreaterThanOrEqual(0)
    expect(hedgeMap.overall_hedge_coverage_pct).toBeLessThanOrEqual(100)
  })

  it('runs a 5-scenario stress test', async () => {
    const db = makeMockDb([{ schemeCode: 'FUND001', schemeType: 'equity' }])
    const kiran = new Kiran(room, webTool, db)

    const scenarioResponse = {
      estimated_portfolio_return_pct: -12,
      worst_case_drawdown_pct: -18,
      recovery_timeline_months: 12,
      most_affected_funds: ['FUND001'],
      least_affected_funds: [],
    }

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(scenarioResponse)),
        },
      },
    } as any)

    const draft = {
      client_id: CLIENT_ID,
      fund_allocations: [{ fund_name: 'Test Fund', scheme_code: 'FUND001', allocation_pct: 100 }],
    }

    const stress = await kiran.runStressTest(draft, RUN_ID)

    expect(stress.scenarios).toHaveLength(5)
    expect(stress.scenarios[0]).toHaveProperty('estimated_portfolio_return_pct')
    expect(stress.scenarios[0].recovery_timeline_months).toBeGreaterThanOrEqual(0)
  })

  it('builds a ClientRiskProfile from demographics', async () => {
    const db = makeMockDb()
    const kiran = new Kiran(room, webTool, db)

    const profileResponse = {
      income_stability_score: 7,
      emergency_fund_months: 6,
      behavioural_risk_tolerance: 'MEDIUM',
      stated_risk_tolerance: 'MEDIUM',
      factors: [
        {
          factor_name: 'Age',
          value: '35 years',
          source_url: 'https://rbi.org.in',
          rationale: 'Longer horizon supports higher equity exposure for discussion.',
        },
      ],
    }

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(profileResponse)),
        },
      },
    } as any)

    const profile = await kiran.buildClientRiskProfile(CLIENT_ID, { age: 35, dependents: 'kids', cityTier: 'metro' }, RUN_ID)

    expect(profile.client_id).toBe(CLIENT_ID)
    expect(profile.behavioural_risk_tolerance).toBe('MEDIUM')
    expect(profile.factors).toHaveLength(1)
  })

  it('produces a daily MacroRiskBulletin', async () => {
    const db = makeMockDb()
    const kiran = new Kiran(room, webTool, db)

    const bulletinResponse = {
      risk_level: 'ELEVATED',
      rbi_policy_signal: 'HOLD',
      fed_signal: 'HOLD',
      india_vix: 18.5,
      india_vix_trend: 'UP',
      brent_crude_usd: 85,
      gold_mcx_inr: 72000,
      usdinr_rate: 83.5,
      usdinr_trend: 'STABLE',
      fii_net_flow_cr: -1200,
      geopolitical_alerts: ['Border tensions'],
      key_risks: ['Rate uncertainty'],
      key_observations: ['FII outflows continued'],
    }

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(bulletinResponse)),
        },
      },
    } as any)

    const bulletin = await kiran.dailyMacroScan(RUN_ID)

    expect(bulletin.risk_level).toBe('ELEVATED')
    expect(bulletin.india_vix).toBe(18.5)
    expect(bulletin.sources.length).toBeGreaterThan(0)
  })
})
