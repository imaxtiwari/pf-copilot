import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sebi } from '../../lib/agents/sebi'
import { randomUUID } from 'crypto'

// Mock Azure OpenAI
vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4o: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params) => {
            const lastMsg = params.messages[params.messages.length - 1].content
            if (lastMsg.includes('SEBI_BLOCK_TEST')) {
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        sebiComplianceFlags: [
                          {
                            rule: "SEBI Circular SEBI/HO/IMD/2021",
                            issue: "Concentration in single AMC exceeds 40%",
                            severity: "BLOCK",
                            remediation: "Reallocate weight to other AMCs"
                          }
                        ],
                        switchingStrategy: [
                          {
                            exitFund: "Mock Exit Fund",
                            entryFund: "Mock Entry Fund",
                            reason: "Tax optimization and AMC diversification",
                            taxImpact: 0,
                            recommendedTiming: "IMMEDIATE"
                          }
                        ],
                        overallCompliant: false
                      })
                    }
                  }
                ]
              }
            }
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      sebiComplianceFlags: [],
                      switchingStrategy: [],
                      overallCompliant: true
                    })
                  }
                }
              ]
            }
          })
        }
      }
    }))
  }
})

describe('SEBI Compliance & Tax Agent Unit Tests', () => {
  let dbMock: any

  beforeEach(() => {
    dbMock = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([{ id: 'test-report-id' }])
    }
  })

  it('should calculate Equity STCG (15%) correctly for holdings < 1 year', async () => {
    const sebi = new Sebi(dbMock)

    // Purchase NAV = 100, current NAV = 150, units = 1000. Current value = 150,000, cost = 100,000, gains = 50,000.
    // Holding period < 1 year (e.g. 6 months ago)
    const existingHoldings = [
      {
        schemeCode: '119551',
        schemeName: 'SBI Bluechip Fund',
        marketValue: '150000',
        units: '1000',
        nav: '150',
        purchaseNav: '100',
        purchaseDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [],
      hedge_instruments: {
        portfolio_id: randomUUID(),
        generated_at: new Date().toISOString(),
        positions: [],
        overall_hedge_coverage_pct: 0,
        sources: []
      },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const
    }

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings,
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: [{ schemeCode: '119551', sebiCategory: 'Equity - Large Cap' }]
    })

    // STCG: 50,000 * 0.15 = 7,500
    expect(report.stcgLiability).toBeCloseTo(7500, 2)
    expect(report.ltcgLiability).toBe(0)
  })

  it('should calculate Equity LTCG (10% over 1L aggregate gains) correctly for holdings >= 1 year', async () => {
    const sebi = new Sebi(dbMock)

    // Purchase NAV = 100, current NAV = 300, units = 1000. Current value = 300,000, cost = 100,000, gains = 200,000.
    // Holding period > 1 year (e.g. 1.5 years ago)
    const existingHoldings = [
      {
        schemeCode: '119551',
        schemeName: 'SBI Bluechip Fund',
        marketValue: '300000',
        units: '1000',
        nav: '300',
        purchaseNav: '100',
        purchaseDate: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [],
      hedge_instruments: {
        portfolio_id: randomUUID(),
        generated_at: new Date().toISOString(),
        positions: [],
        overall_hedge_coverage_pct: 0,
        sources: []
      },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const
    }

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings,
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: [{ schemeCode: '119551', sebiCategory: 'Equity - Large Cap' }]
    })

    // LTCG aggregate gains = 200,000. Exceeds 100,000 limit. Taxable = 100,000. Tax = 100,000 * 0.10 = 10,000.
    expect(report.ltcgLiability).toBeCloseTo(10000, 2)
    expect(report.stcgLiability).toBe(0)
  })

  it('should calculate Debt STCG (slab rate) correctly for holdings < 3 years', async () => {
    const sebi = new Sebi(dbMock)

    // Purchase NAV = 100, current NAV = 120, units = 1000. Current value = 120,000, cost = 100,000, gains = 20,000.
    // Holding period < 3 years (e.g. 1.5 years ago)
    const existingHoldings = [
      {
        schemeCode: '119552',
        schemeName: 'HDFC Short Term Debt Fund',
        marketValue: '120000',
        units: '1000',
        nav: '120',
        purchaseNav: '100',
        purchaseDate: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [],
      hedge_instruments: { portfolio_id: randomUUID(), generated_at: new Date().toISOString(), positions: [], overall_hedge_coverage_pct: 0, sources: [] },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const
    }

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings,
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: [{ schemeCode: '119552', sebiCategory: 'Debt - Short Duration' }]
    })

    // Debt STCG: Gains (20,000) * taxBracket slab rate (30%) = 6,000
    expect(report.stcgLiability).toBeCloseTo(6000, 2)
    expect(report.ltcgLiability).toBe(0)
  })

  it('should calculate Debt LTCG (20% with indexation) correctly for holdings >= 3 years', async () => {
    const sebi = new Sebi(dbMock)

    // Purchase NAV = 100, current NAV = 180, units = 1000. Current value = 180,000, cost = 100,000, gains = 80,000.
    // Holding period >= 3 years (e.g. 3.5 years ago)
    const existingHoldings = [
      {
        schemeCode: '119552',
        schemeName: 'HDFC Short Term Debt Fund',
        marketValue: '180000',
        units: '1000',
        nav: '180',
        purchaseNav: '100',
        purchaseDate: new Date(Date.now() - 3.5 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [],
      hedge_instruments: { portfolio_id: randomUUID(), generated_at: new Date().toISOString(), positions: [], overall_hedge_coverage_pct: 0, sources: [] },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const
    }

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings,
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: [{ schemeCode: '119552', sebiCategory: 'Debt - Short Duration' }]
    })

    // Indexation factor = 1.05 ^ 3 = 1.157625
    // Indexed Cost = 100,000 * 1.157625 = 115,762.5
    // Indexed Gains = 180,000 - 115,762.5 = 64,237.5
    // Tax @ 20% = 64,237.5 * 0.20 = 12,847.5
    expect(report.ltcgLiability).toBeCloseTo(12847.5, 2)
    expect(report.stcgLiability).toBe(0)
  })

  it('should calculate ELSS gap correctly for users in 30% tax bracket', async () => {
    const sebi = new Sebi(dbMock)

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [
        {
          allocation_id: randomUUID(),
          fund_name: 'Mirae Asset Tax Saver Fund',
          isin: 'INF346K01DP8',
          scheme_code: '119553',
          allocation_pct: 20,
          goal_bucket_id: randomUUID(),
          rationale: 'ELSS allocation',
          fund_profile_retrieved_at: new Date().toISOString(),
          overlap_checked: true
        }
      ],
      hedge_instruments: { portfolio_id: randomUUID(), generated_at: new Date().toISOString(), positions: [], overall_hedge_coverage_pct: 0, sources: [] },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const
    }

    const existingHoldings = [
      {
        schemeCode: '119551',
        schemeName: 'SBI Bluechip Fund',
        marketValue: '500000', // Total portfolio value = 5 Lakhs
        units: '5000',
        nav: '100',
        purchaseNav: '100'
      }
    ]

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings,
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: [
        { schemeCode: '119551', sebiCategory: 'Equity - Large Cap' },
        { schemeCode: '119553', sebiCategory: 'Equity - ELSS' }
      ]
    })

    // total current value = 500,000.
    // ELSS allocation % in draft = 20%.
    // Current ELSS amount = 500,000 * 20% = 100,000.
    // Target 80C = 150,000.
    // ELSS Gap = 150,000 - 100,000 = 50,000.
    // Saving opportunity = 50,000 * 30% = 15,000.
    expect(report.elssGap.applicable).toBe(true)
    expect(report.elssGap.currentElssAllocation).toBe(20)
    expect(report.elssGap.recommended80CAllocation).toBe(150000)
    expect(report.elssGap.annualTaxSavingOpportunity).toBeCloseTo(150000 * 0.3 - 100000 * 0.3, 2)
  })

  it('should set overallCompliant to false when a BLOCK severity flag is returned by the LLM', async () => {
    const sebi = new Sebi(dbMock)

    const draft = {
      portfolio_id: randomUUID(),
      client_id: randomUUID(),
      pipeline_run_id: randomUUID(),
      version: 1,
      revision_number: 0,
      goal_buckets: [],
      fund_allocations: [],
      hedge_instruments: { portfolio_id: randomUUID(), generated_at: new Date().toISOString(), positions: [], overall_hedge_coverage_pct: 0, sources: [] },
      confidence_score: { total: 80, breakdown: { data_freshness: 20 as const, goal_achievability: 20 as const, hedge_completeness: 20 as const, critique_severity: 20 as const, backtest_quality: 0 as const }, blocking_reasons: [] },
      backtest_summary: { backtest_id: randomUUID(), period_years: 5, start_date: '2021-01-01', end_date: '2026-01-01', portfolio_cagr_pct: 12, benchmark_cagr_pct: 10, alpha_pct: 2, max_drawdown_pct: 10, max_drawdown_recovery_months: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5, data_completeness_pct: 100, proxy_funds_used: [], scenario_overlay: { portfolio_id: randomUUID(), tested_at: new Date().toISOString(), scenarios: [] } },
      open_critique_items: [],
      universe_filters_applied: [],
      overlap_flags: [],
      status: 'DRAFT' as const,
      notes: 'SEBI_BLOCK_TEST'
    }

    const report = await sebi.runComplianceCheck({
      userId: 'user-1',
      pipelineRunId: 'run-1',
      portfolioDraft: draft,
      existingHoldings: [],
      userProfile: { age: 30, taxBracket: 30 },
      fundSnapshots: []
    })

    expect(report.overallCompliant).toBe(false)
    expect(report.sebiComplianceFlags).toHaveLength(1)
    expect(report.sebiComplianceFlags[0].severity).toBe('BLOCK')
  })
})
