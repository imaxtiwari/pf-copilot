import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Riya } from '../../lib/agents/riya'
import { qdrant } from '../../lib/memory/memory-store'
import { auditTrail } from '../../lib/audit/audit-trail'

// Mock Azure OpenAI
let mockGptResponse = '{}'
vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4oMini: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => ({
            choices: [{ message: { content: mockGptResponse } }]
          }))
        }
      }
    }))
  }
})

// Mock Qdrant
vi.mock('../../lib/memory/memory-store', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    qdrant: {
      scroll: vi.fn().mockResolvedValue({ points: [] }),
      upsert: vi.fn().mockResolvedValue({}),
    }
  }
})

// Mock Soma composition audit
vi.mock('../../lib/agents/soma', () => {
  return {
    Soma: class {
      async auditComposition() {
        return {
          scheme_code: 's1',
          top_holdings: [{ company: 'Mock Corp', allocation_pct: 10 }]
        }
      }
    }
  }
})

describe('Riya Behavioral Profiling Agent', () => {
  let dbMock: any
  let memoryStoreMock: any
  let auditSpy: any

  beforeEach(() => {
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((val) => {
        if (dbMock.lastTable === 'portfolio_holdings') {
          return [
            { schemeCode: 's1', schemeName: 'Fund 1', marketValue: '10000', purchaseDate: '2020-01-01', lastTransactionDate: '2020-01-01' }
          ]
        }
        if (dbMock.lastTable === 'fund_snapshots') {
          return [
            { schemeCode: 's1', snapshotDate: '2026-01-01', return1y: '25.0', alpha3y: '-1.5' }
          ]
        }
        return []
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([{ id: 'test-fingerprint-id' }])
    }

    dbMock.from = vi.fn().mockImplementation((table) => {
      dbMock.lastTable = table.name || table
      return dbMock
    })

    memoryStoreMock = {
      recall: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue('memory-id')
    }

    auditSpy = vi.spyOn(auditTrail, 'log').mockImplementation(() => {})
  })

  it('should run behavioral analysis and return a fingerprint', async () => {
    const fingerprintMock = {
      patterns: [
        { patternType: 'WINNER_CONCENTRATION', severity: 'HIGH', evidence: '60% AUM in >20% return funds', implication: 'Risk of correction' }
      ],
      riskToleranceReality: 'MATCHES_STATED',
      riskToleranceReasoning: 'Matches profile',
      portfolioAbandonmentRisk: 'LOW',
      abandonmentRiskReasoning: 'None',
      constructionGuidance: ['Diversify allocations']
    }
    mockGptResponse = JSON.stringify(fingerprintMock)

    const riya = new Riya(null, memoryStoreMock, null, dbMock)
    
    dbMock.select = vi.fn().mockImplementation(() => {
      return {
        from: vi.fn().mockImplementation((table) => {
          const tName = table.name || table
          return {
            where: vi.fn().mockImplementation(() => {
              return {
                orderBy: vi.fn().mockImplementation(() => {
                  return [
                    { role: 'user', content: 'worry about crash' }
                  ]
                }),
                limit: vi.fn().mockImplementation(() => {
                  if (tName === 'behavioral_fingerprints') return []
                  return []
                }),
                then: (resolve: any) => {
                  if (tName === 'portfolio_holdings') {
                    resolve([
                      { schemeCode: 's1', schemeName: 'Fund 1', marketValue: '10000', purchaseDate: '2020-01-01', lastTransactionDate: '2020-01-01' }
                    ])
                  } else if (tName === 'fund_snapshots') {
                    resolve([
                      { schemeCode: 's1', snapshotDate: '2026-01-01', return1y: '25.0', alpha3y: '-1.5' }
                    ])
                  } else {
                    resolve([])
                  }
                }
              }
            }),
            then: (resolve: any) => {
              if (tName === 'fund_snapshots') {
                resolve([
                  { schemeCode: 's1', snapshotDate: '2026-01-01', return1y: '25.0', alpha3y: '-1.5' }
                ])
              } else {
                resolve([])
              }
            }
          }
        })
      }
    })

    const fp = await riya.getOrGenerateFingerprint('user-1', 'run-1', [])

    expect(fp.riskToleranceReality).toBe('MATCHES_STATED')
    expect(fp.patterns[0].patternType).toBe('WINNER_CONCENTRATION')
    expect(dbMock.insert).toHaveBeenCalled()
    expect(memoryStoreMock.write).toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalled()
  })

  it('should hit cache when Qdrant contains active memory fingerprint', async () => {
    const fingerprintMock = {
      patterns: [],
      riskToleranceReality: 'MATCHES_STATED',
      riskToleranceReasoning: 'Cached',
      portfolioAbandonmentRisk: 'LOW',
      abandonmentRiskReasoning: 'Cached',
      constructionGuidance: []
    }
    
    vi.mocked(qdrant.scroll).mockResolvedValueOnce({
      points: [
        {
          id: 'p1',
          payload: {
            tags: ['riya:behavioral_fingerprint:user-1'],
            content: JSON.stringify(fingerprintMock),
            created_at: new Date().toISOString(),
            status: 'ACTIVE'
          }
        }
      ]
    })

    const riya = new Riya(null, memoryStoreMock, null, dbMock)
    const fp = await riya.getOrGenerateFingerprint('user-1', 'run-1', [])

    expect(fp.riskToleranceReasoning).toBe('Cached')
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ cache_hit: true })
    }))
  })
})
