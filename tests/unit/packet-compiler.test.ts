import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PacketCompiler } from '@/lib/agents/dhruv/packet-compiler'
import { getGpt4o } from '@/lib/azure-openai'

vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'
const PORTFOLIO_ID = 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33'
const ALLOCATION_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a01'
const GOAL_BUCKET_ID = 'e0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const BACKTEST_ID = 'b0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const ASSESSMENT_ID = 'c1eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'

function makeFault(overrides: Partial<any> = {}): any {
  return {
    fault_id: 'f0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11',
    fault_category: 'OTHER',
    fault_description: 'A fault for testing.',
    evidence_sources: [],
    severity: 'MINOR',
    suggested_remedy: '',
    confidence_tier: 'VERIFIED',
    ...overrides,
  }
}

function makeDraft(overrides: Partial<any> = {}): any {
  const now = new Date().toISOString()
  return {
    portfolio_id: PORTFOLIO_ID,
    client_id: CLIENT_ID,
    pipeline_run_id: RUN_ID,
    version: 1,
    revision_number: 0,
    goal_buckets: [],
    fund_allocations: [
      {
        allocation_id: ALLOCATION_ID,
        fund_name: 'Equity Fund A',
        isin: 'INE001A01036',
        scheme_code: 'FUND001',
        allocation_pct: 60,
        goal_bucket_id: GOAL_BUCKET_ID,
        rationale: 'Core equity allocation.',
        fund_profile_retrieved_at: now,
        overlap_checked: true,
      },
    ],
    hedge_instruments: {
      hedge_map_id: 'h1',
      portfolio_id: PORTFOLIO_ID,
      generated_at: now,
      positions: [],
      overall_hedge_coverage_pct: 85,
      sources: [],
    },
    confidence_score: {
      total: 80,
      breakdown: { data_freshness: 20, goal_achievability: 20, hedge_completeness: 20, critique_severity: 20, backtest_quality: 0 },
      blocking_reasons: [],
    },
    backtest_summary: {
      backtest_id: BACKTEST_ID,
      period_years: 5,
      start_date: '2019-01-01',
      end_date: '2024-01-01',
      portfolio_cagr_pct: 12,
      benchmark_cagr_pct: 11,
      alpha_pct: 1,
      max_drawdown_pct: -15,
      max_drawdown_recovery_months: 6,
      sharpe_ratio: 0.8,
      sortino_ratio: 1.1,
      data_completeness_pct: 75,
      proxy_funds_used: [],
      scenario_overlay: { portfolio_id: PORTFOLIO_ID, tested_at: now, scenarios: [] },
    },
    open_critique_items: [makeFault({ severity: 'MINOR', fault_category: 'OTHER' })],
    overlap_flags: [],
    universe_filters_applied: [],
    status: 'DRAFT',
    ...overrides,
  }
}

function makeGoalAssessment(overrides: Partial<any> = {}): any {
  return {
    assessment_id: ASSESSMENT_ID,
    client_id: CLIENT_ID,
    version: 1,
    assessed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    stated_goals: ['Retirement corpus'],
    decomposed_goals: [],
    achievability_verdict: 'ALIGNS_WITH_GOALS',
    goal_sequence_conflicts: [],
    sources: [],
    ...overrides,
  }
}

describe('PacketCompiler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('compiles a final packet using the LLM summary', async () => {
    const compiler = new PacketCompiler()
    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: 'Custom executive summary.' } }],
          })),
        },
      },
    } as any)

    const packet = await compiler.compileFinalPortfolioPacket(makeDraft(), RUN_ID, makeGoalAssessment())

    expect(packet.executive_summary).toBe('Custom executive summary.')
    expect(packet.pipeline_run_id).toBe(RUN_ID)
    expect(packet.client_id).toBe(CLIENT_ID)
    expect(packet.open_observations).toHaveLength(1)
    expect(packet.open_observations[0].severity).toBe('MINOR')
  })

  it('falls back to a default summary when the LLM call fails', async () => {
    const compiler = new PacketCompiler()
    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error('LLM unavailable')
          }),
        },
      },
    } as any)

    const packet = await compiler.compileFinalPortfolioPacket(makeDraft(), RUN_ID, makeGoalAssessment())

    expect(packet.executive_summary).toContain('Hypothetical portfolio packet compiled')
    expect(packet.sebi_disclaimer).toBeDefined()
  })

  it('uses the provided sebi report disclaimer', async () => {
    const compiler = new PacketCompiler()
    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => ({ choices: [{ message: { content: 'Summary.' } }] })),
        },
      },
    } as any)

    const packet = await compiler.compileFinalPortfolioPacket(makeDraft(), RUN_ID, makeGoalAssessment(), { disclaimer: 'Custom disclaimer.' })

    expect(packet.sebi_disclaimer).toBe('Custom disclaimer.')
  })

  it('computes data freshness from the oldest fund profile timestamp', async () => {
    const compiler = new PacketCompiler()
    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => ({ choices: [{ message: { content: 'Summary.' } }] })),
        },
      },
    } as any)

    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const draft = makeDraft({
      fund_allocations: [
        {
          allocation_id: 'a1eebc99-5c0b-4ef8-bb6d-6bb9bd380a11',
          fund_name: 'Fund A',
          isin: 'INE001',
          scheme_code: 'F001',
          allocation_pct: 50,
          goal_bucket_id: GOAL_BUCKET_ID,
          rationale: '',
          fund_profile_retrieved_at: staleDate,
          overlap_checked: true,
        },
        {
          allocation_id: 'a2eebc99-5c0b-4ef8-bb6d-6bb9bd380a11',
          fund_name: 'Fund B',
          isin: 'INE002',
          scheme_code: 'F002',
          allocation_pct: 50,
          goal_bucket_id: GOAL_BUCKET_ID,
          rationale: '',
          fund_profile_retrieved_at: new Date().toISOString(),
          overlap_checked: true,
        },
      ],
    })

    const packet = await compiler.compileFinalPortfolioPacket(draft, RUN_ID, makeGoalAssessment())

    expect(packet.data_freshness_disclosure).toContain('10')
    expect(packet.data_freshness_disclosure).toContain('days old')
  })

  it('reports zero data freshness days when no timestamps exist', async () => {
    const compiler = new PacketCompiler()
    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => ({ choices: [{ message: { content: 'Summary.' } }] })),
        },
      },
    } as any)

    const draft = makeDraft({ fund_allocations: [] })
    const packet = await compiler.compileFinalPortfolioPacket(draft, RUN_ID, makeGoalAssessment())

    expect(packet.data_freshness_disclosure).toContain('0 days')
  })
})

