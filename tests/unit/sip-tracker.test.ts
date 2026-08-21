import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trackSIPAdherence } from '../../lib/sip/sip-tracker'
import * as schema from '../../db/schema'

describe('SIP Adherence Tracker', () => {
  let dbMock: any
  let lastTableQueried: any = null

  beforeEach(() => {
    lastTableQueried = null
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table) => {
        lastTableQueried = table
        return dbMock
      }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        if (lastTableQueried === schema.pipelineResults) {
          return Promise.resolve([{
            data: {
              client_goal_summary: {
                decomposed_goals: [
                  {
                    goal_id: 'goal-1',
                    goal_type: 'RETIREMENT',
                    description: 'Retirement corpus',
                    monthly_sip_required_lakh: 0.25, // 25,000/mo
                  }
                ]
              }
            }
          }])
        }
        if (lastTableQueried === schema.sipAdherenceReports) {
          // Mock previous report: user was running Fund 1 SIP at 10,000 previously
          return Promise.resolve([{
            report: {
              detectedSIPs: [
                {
                  schemeName: 'Fund 1',
                  estimatedMonthlyAmount: 10000,
                  confidence: 'HIGH',
                  monthsRunning: 2
                }
              ]
            }
          }])
        }
        return Promise.resolve([])
      })
    }
  })

  it('should calculate target SIPs, match detected SIPs, and compute correct scores and warnings', async () => {
    const approvedPortfolio = {
      pipelineRunId: 'run-123',
      clientId: 'user-456',
      fundAllocations: [
        { fund_name: 'Fund 1', scheme_code: 's1', allocation_pct: 60, goal_bucket_id: 'goal-1' }, // 60% of 25,000 = 15,000 target
        { fund_name: 'Fund 2', scheme_code: 's2', allocation_pct: 40, goal_bucket_id: 'goal-1' }  // 40% of 25,000 = 10,000 target
      ],
      goalBuckets: [
        { bucket_id: 'goal-1', goal_id: 'goal-1', goal_type: 'RETIREMENT' }
      ]
    }

    const driftReport = {
      previousUploadAt: new Date(), // makes SIP detection possible
      sipDetection: [
        { schemeName: 'Fund 1', estimatedMonthlyAmount: 10000, confidence: 'HIGH' }, // shortfall of 5,000
        // Fund 2 has no detected SIP -> shortfall of 10,000 (status: NOT_STARTED)
      ]
    }

    const report = await trackSIPAdherence(approvedPortfolio, driftReport, {}, dbMock)

    // Verify Recommended SIP breakdown
    expect(report.recommendedSIPs).toHaveLength(2)
    const recFund1 = report.recommendedSIPs.find(r => r.schemeName === 'Fund 1')
    const recFund2 = report.recommendedSIPs.find(r => r.schemeName === 'Fund 2')
    expect(recFund1?.monthlyAmount).toBe(15000)
    expect(recFund2?.monthlyAmount).toBe(10000)

    // Verify Detected SIPs
    expect(report.detectedSIPs).toHaveLength(1)
    expect(report.detectedSIPs[0].schemeName).toBe('Fund 1')
    expect(report.detectedSIPs[0].estimatedMonthlyAmount).toBe(10000)
    expect(report.detectedSIPs[0].monthsRunning).toBe(3) // 2 (prev) + 1 = 3

    // Verify Adherence breakdown
    expect(report.adherenceByFund).toHaveLength(2)
    const fund1Adherence = report.adherenceByFund.find(f => f.schemeName === 'Fund 1')
    const fund2Adherence = report.adherenceByFund.find(f => f.schemeName === 'Fund 2')
    expect(fund1Adherence?.status).toBe('UNDER_INVESTING')
    expect(fund2Adherence?.status).toBe('NOT_STARTED')

    // Verify score: weighted (10,000 actual vs 25,000 recommended) -> 40% score
    expect(report.overallAdherenceScore).toBe(40)

    // Verify shortfall: 5,000 (Fund 1) + 10,000 (Fund 2) = 15,000
    expect(report.monthlyShortfall).toBe(15000)

    // Verify 1 year compounding projection at 12% CAGR
    // Sum of 15000 * (1 + 0.01)^(12 - month) for month=1..12
    expect(report.projectedCorpusImpact).toBeGreaterThan(180000) // simple sum is 180,000, compounded must be higher
    expect(report.projectedCorpusImpact).toBeCloseTo(190204, -2) // roughly 190,200

    // Verify Alerts
    expect(report.alerts.some(a => a.type === 'SIP_NOT_STARTED' && a.urgency === 'HIGH')).toBe(true)
    expect(report.alerts.some(a => a.type === 'AMOUNT_SHORT' && a.urgency === 'MEDIUM')).toBe(true)

    // Verify Projection Details
    expect(report.projectionDetails.goalName).toBe('Retirement corpus')
  })

  it('should handle first upload cold start by not penalizing undetected SIPs', async () => {
    const approvedPortfolio = {
      pipelineRunId: 'run-123',
      clientId: 'user-456',
      fundAllocations: [
        { fund_name: 'Fund 1', scheme_code: 's1', allocation_pct: 100, goal_bucket_id: 'goal-1' }
      ],
      goalBuckets: [
        { bucket_id: 'goal-1', goal_id: 'goal-1', goal_type: 'RETIREMENT' }
      ]
    }

    const driftReport = {
      previousUploadAt: null, // First upload, SIP detection not possible
      sipDetection: []
    }

    const report = await trackSIPAdherence(approvedPortfolio, driftReport, {}, dbMock)

    // Verify Status is UNDETECTED and score is 100% (since we couldn't detect anything)
    expect(report.adherenceByFund[0].status).toBe('UNDETECTED')
    expect(report.overallAdherenceScore).toBe(100)
    expect(report.monthlyShortfall).toBe(0)
    expect(report.alerts.some(a => a.type === 'ON_TRACK')).toBe(true)
  })
})
