import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PortfolioRationaleGenerator } from '../../lib/pdf/portfolio-rationale-generator'
import * as schema from '../../db/schema'

describe('Portfolio Rationale PDF Generator', () => {
  let dbMock: any
  let lastTableQueried = ''

  beforeEach(() => {
    lastTableQueried = ''
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table) => {
        lastTableQueried = table.name || ''
        return dbMock
      }),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        if (lastTableQueried === 'user_profile') {
          return Promise.resolve([{
            age: 35,
            cityTier: 'metro',
            dependents: 'kids',
            inflationRate: '0.072',
          }])
        }
        if (lastTableQueried === 'behavioral_fingerprints') {
          return Promise.resolve([{
            fingerprint: {
              patterns: [],
              riskToleranceReality: 'MATCHES_STATED',
              riskToleranceReasoning: 'Consistent response to risk questions.',
              portfolioAbandonmentRisk: 'LOW',
              abandonmentRiskReasoning: 'Strong financial buffer.',
              constructionGuidance: []
            }
          }])
        }
        if (lastTableQueried === 'compliance_reports') {
          return Promise.resolve([{
            report: {
              taxEfficiencyScore: 92,
              stcgLiability: 12000,
              ltcgLiability: 4000,
              recommendedSwitchOrder: ['Fund A', 'Fund B'],
              elssGap: { applicable: true, gap: 35000 }
            }
          }])
        }
        if (lastTableQueried === 'comparison_reports') {
          return Promise.resolve([{
            report: {
              overlapAnalysis: { overlapPercentage: 15.5 },
              costAnalysis: { annualSavingsEstimate: 5000 },
            }
          }])
        }
        if (lastTableQueried === 'cas_uploads') {
          return Promise.resolve([{
            rawTextPreview: 'Investor Name: Rajesh Kumar\nPAN: XXXXXXX'
          }])
        }
        if (lastTableQueried === 'agent_funds') {
          return Promise.resolve([
            { schemeCode: 's1', sebiCategory: 'Flexi Cap Fund' },
            { schemeCode: 's2', sebiCategory: 'Debt Index Fund' }
          ])
        }
        return Promise.resolve([])
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    }
    // Final chain return resolves
    dbMock.where = vi.fn().mockImplementation((condition) => {
      // If we are doing select/where, return dbMock (builder) to allow limit() to be called.
      // If we are doing update/set/where, return resolved Promise since it is awaited directly.
      if (lastTableQueried === 'pipeline_results' && dbMock.set.mock.calls.length > 0) {
        return Promise.resolve([{ id: 'updated-id' }])
      }
      return dbMock
    })
  })

  it('should retrieve client name, compile PDF data, and save PDF base64 string to database', async () => {
    const generator = new PortfolioRationaleGenerator(dbMock)

    const dummyPacket = {
      executive_summary: 'This is a mocked portfolio executive summary detailing optimal risk adjusted allocations.',
      client_goal_summary: {
        stated_goals: ['Retirement'],
        decomposed_goals: [
          {
            description: 'Retirement fund',
            goal_type: 'RETIREMENT',
            target_corpus_lakh: 120,
            target_date: '2045-12-31',
            current_corpus_lakh: 10,
            monthly_sip_required_lakh: 0.25,
            required_cagr_pct: 12.5,
          }
        ]
      },
      full_portfolio: {
        fund_allocations: [
          { fund_name: 'Parag Parikh Flexi Cap Fund', scheme_code: 's1', allocation_pct: 60, rationale: 'Core global-Indian exposure' },
          { fund_name: 'SBI Debt Index Fund', scheme_code: 's2', allocation_pct: 40, rationale: 'Low volatility stable buffer' }
        ],
        strategy_framework: {
          selected_frameworks: [{ name: 'MODERATE' }]
        },
        backtest_summary: {
          scenario_overlay: {
            scenarios: [
              { scenario_name: 'Indian equity bear market (-30%)', estimated_portfolio_return_pct: -15, worst_case_drawdown_pct: -20 }
            ]
          }
        },
        hedge_instruments: {
          positions: [
            { risk_scenario: 'Indian equity bear market (-30%)', hedge_instrument: 'Short Nifty Options', hedge_rationale: 'Mitigates large market drawdowns.' }
          ]
        }
      }
    }

    await generator.generateAndSave('run1', 'user1', dummyPacket)

    // Check that update was called on pipeline_results
    expect(dbMock.update).toHaveBeenCalledWith(schema.pipelineResults)
    
    // Check that set was called with base64 PDF string
    const setCallArgs = dbMock.set.mock.calls[0][0]
    expect(setCallArgs.rationalePdfUrl).toBeDefined()
    expect(typeof setCallArgs.rationalePdfUrl).toBe('string')
    expect(setCallArgs.rationalePdfUrl.length).toBeGreaterThan(100) // should be a substantial Base64 string
    expect(setCallArgs.rationalePdfGeneratedAt).toBeDefined()
  })
})
