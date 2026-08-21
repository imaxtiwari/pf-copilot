import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectDrift } from '../../lib/cas/drift-detector'
import * as schema from '../../db/schema'

// Mock the database
let mockCasUploads: any[] = []
let mockHoldings: any[] = []
let mockPipelineRuns: any[] = []
let mockPipelineResults: any[] = []

vi.mock('../../lib/db', () => {
  const queryChain = (table: any) => {
    const mockResult = () => {
      if (table === schema.casUploads) return mockCasUploads
      if (table === schema.portfolioHoldings) return mockHoldings
      if (table === schema.pipelineRuns) return mockPipelineRuns
      if (table === schema.pipelineResults) return mockPipelineResults
      return []
    }

    const mockLimit = vi.fn((n) => mockResult().slice(0, n))
    const mockOrderBy = vi.fn(() => {
      const chain = {
        limit: mockLimit,
        then: (onfulfilled: any) => Promise.resolve(mockResult()).then(onfulfilled),
        catch: (onrejected: any) => Promise.resolve(mockResult()).catch(onrejected)
      }
      return chain
    })

    const mockWhere = vi.fn(() => {
      const chain = {
        orderBy: mockOrderBy,
        limit: mockLimit,
        then: (onfulfilled: any) => Promise.resolve(mockResult()).then(onfulfilled),
        catch: (onrejected: any) => Promise.resolve(mockResult()).catch(onrejected)
      }
      return chain
    })

    const chain = {
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      then: (onfulfilled: any) => Promise.resolve(mockResult()).then(onfulfilled),
      catch: (onrejected: any) => Promise.resolve(mockResult()).catch(onrejected)
    }

    return chain
  }

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => queryChain(table))
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve({}))
      }))
    }
  }
})

describe('Portfolio Drift Detector Unit Tests', () => {
  beforeEach(() => {
    mockCasUploads = []
    mockHoldings = []
    mockPipelineRuns = []
    mockPipelineResults = []
  })

  it('correctly calculates basic position deltas, exits, and new entries', async () => {
    const prevHoldings = [
      { schemeName: 'Fund A', schemeCode: '1001', units: '100', nav: '10', marketValue: '1000', asOfDate: '2026-05-19' },
      { schemeName: 'Fund B', schemeCode: '1002', units: '50', nav: '20', marketValue: '1000', asOfDate: '2026-05-19' }
    ]

    const currHoldings = [
      { schemeName: 'Fund A', schemeCode: '1001', units: '110', nav: '12', marketValue: '1320', asOfDate: '2026-06-19', userId: 'user-1' },
      { schemeName: 'Fund C', schemeCode: '1003', units: '20', nav: '15', marketValue: '300', asOfDate: '2026-06-19', userId: 'user-1' }
    ]

    const report = await detectDrift(prevHoldings, currHoldings)

    expect(report.daysBetweenUploads).toBe(31)
    expect(report.changes.newPositions).toHaveLength(1)
    expect(report.changes.newPositions[0].schemeName).toBe('Fund C')

    expect(report.changes.exitedPositions).toHaveLength(1)
    expect(report.changes.exitedPositions[0].schemeName).toBe('Fund B')

    expect(report.changes.increased).toHaveLength(1)
    expect(report.changes.increased[0].schemeName).toBe('Fund A')
    expect(report.changes.increased[0].unitsDelta).toBeCloseTo(10)
    expect(report.changes.increased[0].reason).toBe('LUMPSUM')

    expect(report.portfolioReturn.nominalReturn).toBeCloseTo(-19) // (1620 - 2000) / 2000 * 100 = -19%
  })

  it('correctly detects active SIPs across multiple uploads', async () => {
    const uploadId1 = 'u-1'
    const uploadId2 = 'u-2'
    const uploadId3 = 'u-3'

    mockCasUploads = [
      { id: uploadId1, uploadedAt: new Date('2026-04-19'), status: 'validated' },
      { id: uploadId2, uploadedAt: new Date('2026-05-19'), status: 'validated' },
      { id: uploadId3, uploadedAt: new Date('2026-06-19'), status: 'validated' }
    ]

    mockHoldings = [
      // Upload 1 holdings
      { schemeName: 'Fund A', schemeCode: '1001', units: '100', nav: '10', marketValue: '1000', casUploadId: uploadId1, userId: 'user-1' },
      // Upload 2 holdings
      { schemeName: 'Fund A', schemeCode: '1001', units: '110', nav: '10', marketValue: '1100', casUploadId: uploadId2, userId: 'user-1' },
      // Upload 3 holdings
      { schemeName: 'Fund A', schemeCode: '1001', units: '120', nav: '10', marketValue: '1200', casUploadId: uploadId3, userId: 'user-1' }
    ]

    const prevHoldings = mockHoldings.filter(h => h.casUploadId === uploadId2)
    const currHoldings = mockHoldings.filter(h => h.casUploadId === uploadId3)

    const report = await detectDrift(prevHoldings, currHoldings)

    expect(report.sipDetection).toHaveLength(1)
    expect(report.sipDetection[0].schemeName).toBe('Fund A')
    expect(report.sipDetection[0].estimatedMonthlyAmount).toBe(100) // 10 units * 10 NAV
    expect(report.sipDetection[0].confidence).toBe('MEDIUM') // 2 consecutive steps
  })

  it('correctly detects plan drift when approved recommendation exists', async () => {
    mockPipelineRuns = [
      { runId: 'run-1', clientId: 'user-1', status: 'APPROVED', completedAt: new Date() }
    ]

    mockPipelineResults = [
      {
        resultId: 'res-1',
        pipelineRunId: 'run-1',
        resultType: 'packet',
        data: {
          portfolio_draft: {
            fund_allocations: [
              { scheme_code: '1001', fund_name: 'Fund A', allocation_pct: 50 },
              { scheme_code: '1002', fund_name: 'Fund B', allocation_pct: 50 }
            ]
          }
        }
      }
    ]

    const prevHoldings: any[] = []
    const currHoldings = [
      { schemeName: 'Fund A', schemeCode: '1001', units: '100', nav: '10', marketValue: '1000', userId: 'user-1' }
    ]

    const report = await detectDrift(prevHoldings, currHoldings)

    expect(report.driftFromRecommendation).toBeDefined()
    expect(report.driftFromRecommendation?.rebalancingNeeded).toBe(true)
    expect(report.driftFromRecommendation?.rebalancingUrgency).toBe('HIGH') // 100% vs 50% = 50% drift > 10%
    expect(report.driftFromRecommendation?.allocationDrift).toHaveLength(2)
  })
})
