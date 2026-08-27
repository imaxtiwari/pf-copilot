import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { Priya, computeConfidenceScore } from '@/lib/agents/priya'
import { getGpt4o } from '@/lib/azure-openai'
import { runBacktest } from '@/lib/agents/priya-backtest'

vi.mock('@/lib/agents/soma', () => {
  class MockSoma {
    auditComposition = vi.fn(async (code: string) => ({
      scheme_code: code,
      top_holdings: [{ company: 'ABC Ltd', allocation_pct: 5 }],
    }))
  }
  return { Soma: MockSoma }
})

vi.mock('@/lib/agents/priya-backtest', () => ({
  runBacktest: vi.fn(async () => ({
    backtest_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    period_years: 5,
    start_date: '2019-01-01',
    end_date: '2024-01-01',
    portfolio_cagr_pct: 12.5,
    benchmark_cagr_pct: 11.2,
    alpha_pct: 1.3,
    max_drawdown_pct: -15.4,
    max_drawdown_recovery_months: 4,
    sharpe_ratio: 0.85,
    sortino_ratio: 1.15,
    data_completeness_pct: 72,
    proxy_funds_used: [],
    scenario_overlay: {
      portfolio_id: 'p1',
      tested_at: new Date().toISOString(),
      scenarios: [
        {
          scenario_name: 'Bear market',
          description: 'A sharp correction',
          estimated_portfolio_return_pct: -20,
          worst_case_drawdown_pct: -25,
          recovery_timeline_months: 12,
          most_affected_funds: ['FUND001'],
          least_affected_funds: [],
        },
      ],
    },
  })),
}))

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
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
  getGpt4oMini: vi.fn(),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'
const GOAL_ID = 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a44'

function makeDb() {
  return {
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
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

function makeInputs() {
  const now = new Date().toISOString()
  return {
    goalAssessment: {
      assessment_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
      client_id: CLIENT_ID,
      version: 1,
      assessed_at: now,
      expires_at: now,
      stated_goals: ['Retirement corpus'],
      decomposed_goals: [
        {
          goal_id: GOAL_ID,
          goal_type: 'RETIREMENT' as const,
          description: 'Retirement',
          target_corpus_lakh: 500,
          target_date: '2045-01-01',
          current_corpus_lakh: 10,
          monthly_sip_required_lakh: 0.5,
          required_cagr_pct: 10,
          inflation_adjusted_target_lakh: 600,
          inflation_rate_used_pct: 6,
        },
      ],
      achievability_verdict: 'ALIGNS_WITH_GOALS' as const,
      goal_sequence_conflicts: [],
      sources: [],
      hypothesis_mode: false,
      user_corrections: [],
      correction_rounds: 0,
    },
    riskProfile: {
      profile_id: 'p0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
      client_id: CLIENT_ID,
      version: 1,
      generated_at: now,
      expires_at: now,
      age: 35,
      years_to_goal: 20,
      income_stability_score: 7,
      existing_liabilities: null,
      dependants: 'kids' as const,
      emergency_fund_months: 6,
      insurance_coverage: 'Standard',
      tax_bracket_pct: 30,
      behavioural_risk_tolerance: 'MEDIUM' as const,
      stated_risk_tolerance: 'MEDIUM' as const,
      geographic_income_risk: 'metro',
      factors: [],
    },
    strategyFramework: {
      framework_id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77',
      client_id: CLIENT_ID,
      selected_frameworks: [
        {
          name: 'Goal-based allocation',
          description: 'Allocate by goal horizon',
          why_applicable: 'Long horizon',
          source_url: 'https://example.com',
          retrieved_at: now,
        },
      ],
      asset_allocation_guidance: {
        equity_pct_range: [60, 80] as [number, number],
        debt_pct_range: [20, 40] as [number, number],
        gold_pct_range: [0, 10] as [number, number],
        international_pct_range: [0, 10] as [number, number],
      },
    },
    hedgeMap: {
      portfolio_id: 'h1',
      generated_at: now,
      positions: [],
      overall_hedge_coverage_pct: 85,
      sources: [{ url: 'https://rbi.org.in', retrieved_at: now }],
    },
    critiques: [
      {
        report_id: 'r0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
        pipeline_run_id: RUN_ID,
        draft_version: 1,
        critiqued_at: now,
        faults: [],
        critical_count: 0,
        major_count: 0,
        minor_count: 0,
        observation_count: 0,
        overall_assessment: 'No major issues',
      },
    ],
    fundUniverse: {
      universe_id: 'u0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
      generated_at: now,
      pipeline_run_id: RUN_ID,
      filters_applied: [{ filter: 'min_aum_equity_cr', threshold: '>=500 Cr' }],
      eligible_funds: [
        {
          scheme_code: 'FUND001',
          scheme_name: 'Test Large Cap',
          scheme_type: 'equity' as const,
          aum_cr: 1200,
          expense_ratio: 1.2,
          return_3y: 12,
          sharpe_3y: 0.8,
          track_record_years: 5,
        },
        {
          scheme_code: 'FUND002',
          scheme_name: 'Test Debt',
          scheme_type: 'debt' as const,
          aum_cr: 1500,
          expense_ratio: 0.8,
          return_3y: 7,
          sharpe_3y: 0.6,
          track_record_years: 7,
        },
      ],
      total_screened: 10,
      total_eligible: 2,
    },
  }
}

describe('Priya', () => {
  const room = new DeliberationRoom()
  const webTool = { research: vi.fn(async () => []) } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds a portfolio draft with the educational label', async () => {
    const db = makeDb()
    const priya = new Priya(room, webTool, db)

    const llmResponse = {
      goal_buckets: [
        {
          bucket_id: 'bucket-1',
          goal_id: GOAL_ID,
          goal_type: 'RETIREMENT',
          target_corpus_lakh: 500,
          target_date: '2045-01-01',
          time_horizon_years: 20,
          risk_profile: 'MODERATE',
          allocation_pct: 100,
        },
      ],
      fund_allocations: [
        {
          allocation_id: 'alloc-1',
          fund_name: 'Test Large Cap',
          isin: 'IN0000000001',
          scheme_code: 'FUND001',
          allocation_pct: 70,
          goal_bucket_id: 'bucket-1',
          rationale: 'Core equity exposure',
        },
        {
          allocation_id: 'alloc-2',
          fund_name: 'Test Debt',
          isin: 'IN0000000002',
          scheme_code: 'FUND002',
          allocation_pct: 30,
          goal_bucket_id: 'bucket-1',
          rationale: 'Stabilizer',
        },
      ],
    }

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(llmResponse)),
        },
      },
    } as any)

    const inputs = makeInputs()
    const draft = await priya.buildPortfolio(inputs, RUN_ID)

    const total = draft.fund_allocations.reduce((sum, a) => sum + a.allocation_pct, 0)
    expect(total).toBe(100)
    expect(draft.status).toBe('DRAFT')
    expect(draft.confidence_score.total).toBeGreaterThanOrEqual(60)
    expect(draft.fund_allocations[0].rationale).toContain('hypothetical allocation for educational discussion')
  })

  it('throws when confidence score is below threshold', async () => {
    const db = makeDb()
    const priya = new Priya(room, webTool, db)

    vi.mocked(runBacktest).mockResolvedValueOnce({
      backtest_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      period_years: 5,
      start_date: '2019-01-01',
      end_date: '2024-01-01',
      portfolio_cagr_pct: 12.5,
      benchmark_cagr_pct: 11.2,
      alpha_pct: 1.3,
      max_drawdown_pct: -15.4,
      max_drawdown_recovery_months: 4,
      sharpe_ratio: 0.85,
      sortino_ratio: 1.15,
      data_completeness_pct: 50,
      proxy_funds_used: [],
      scenario_overlay: {
        portfolio_id: 'p1',
        tested_at: new Date().toISOString(),
        scenarios: [
          {
            scenario_name: 'Bear market',
            description: 'A sharp correction',
            estimated_portfolio_return_pct: -20,
            worst_case_drawdown_pct: -25,
            recovery_timeline_months: 12,
            most_affected_funds: ['FUND001'],
            least_affected_funds: [],
          },
        ],
      },
    } as any)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              goal_buckets: [
                {
                  bucket_id: 'bucket-1',
                  goal_id: GOAL_ID,
                  goal_type: 'RETIREMENT',
                  target_corpus_lakh: 500,
                  target_date: '2045-01-01',
                  time_horizon_years: 20,
                  risk_profile: 'MODERATE',
                  allocation_pct: 100,
                },
              ],
              fund_allocations: [
                {
                  allocation_id: 'alloc-1',
                  fund_name: 'Test Large Cap',
                  isin: 'IN0000000001',
                  scheme_code: 'FUND001',
                  allocation_pct: 100,
                  goal_bucket_id: 'bucket-1',
                  rationale: 'Core equity exposure',
                },
              ],
            }),
          ),
        },
      },
    } as any)

    const inputs = makeInputs()
    inputs.hedgeMap.overall_hedge_coverage_pct = 50
    ;(inputs.critiques[0].faults as any[]).push({
      fault_id: 'f0eebc99-5c0b-4ef8-bb6d-6bb9bd380a99',
      fault_category: 'CONCENTRATION',
      fault_description: 'Single fund concentration is too high',
      evidence_sources: [],
      severity: 'CRITICAL',
      confidence_tier: 'VERIFIED',
    })
    await expect(priya.buildPortfolio(inputs, RUN_ID)).rejects.toThrow('Confidence score threshold failed')
  })

  it('computes a deterministic confidence score', () => {
    const score = computeConfidenceScore({
      dataFresh: true,
      achievabilityVerdict: 'ALIGNS_WITH_GOALS',
      overallHedgeCoveragePct: 85,
      critiqueFaults: [],
      backtestPeriodYears: 5,
      backtestCompletenessPct: 75,
    })

    expect(score.total).toBe(100)
    expect(score.breakdown.data_freshness).toBe(20)
    expect(score.blocking_reasons).toHaveLength(0)
  })
})
