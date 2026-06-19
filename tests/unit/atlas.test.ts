import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Atlas } from '../../lib/agents/atlas'

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

describe('Atlas Comparison Agent', () => {
  let dbMock: any

  beforeEach(() => {
    dbMock = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([{ id: 'test-report-id' }]),
    }
  })

  it('should generate a comparison report with correct mathematical heuristics', async () => {
    mockGptResponse = JSON.stringify({
      consolidationInsight: "The recommended portfolio consolidates overlapping funds to improve expected alpha while maintaining core strategy alignment.",
      switchingCost: {
        qualitativeFriction: "Medium"
      }
    })

    const atlas = new Atlas(dbMock)
    
    const draft = {
      fundAllocations: [
        { schemeCode: 's1', fundName: 'Fund 1', allocationPct: 100 }
      ]
    }
    const existingHoldings = [
      { schemeCode: 's1', schemeName: 'Fund 1', marketValue: '1000' },
      { schemeCode: 's2', schemeName: 'Fund 2', marketValue: '3000' }
    ]
    const fundSnapshots = [
      { schemeCode: 's1', schemeName: 'Fund 1', return3y: 12.5, alpha3y: 1.875, expenseRatio: 0.5 },
      { schemeCode: 's2', schemeName: 'Fund 2', return3y: 10.0, alpha3y: 0.0, expenseRatio: 1.5 }
    ]

    const report = await atlas.generateReport('user1', 'run1', draft, existingHoldings, fundSnapshots)
    
    // Total current value = 4000. s1 = 25%, s2 = 75%
    // Recommended value = 4000. s1 = 100%
    
    // Overlap: Min of current (25%) and recommended (100%) for s1 = 25%
    expect(report.overlapAnalysis.overlapPercentage).toBeCloseTo(25.0, 2)
    
    // Shared funds: 'fund 1'
    expect(report.overlapAnalysis.sharedFunds).toContain('Fund 1')
    
    // Exit funds: 'fund 2'
    expect(report.overlapAnalysis.exitFunds).toContain('Fund 2')
    
    // Cost Analysis
    // Current weighted ER: (0.25 * 0.5) + (0.75 * 1.5) = 1.25%
    expect(report.costAnalysis.currentWeightedExpenseRatio).toBeCloseTo(1.25, 3)
    // Recommended ER: (1.0 * 0.5) = 0.5%
    expect(report.costAnalysis.recommendedWeightedExpenseRatio).toBeCloseTo(0.5, 3)
    
    // Return Analysis
    // Current return: (0.25 * 12.5) + (0.75 * 10.0) = 10.625% -> rounded to 10.63%
    expect(report.returnAnalysis.currentPortfolio3YrReturn).toBeCloseTo(10.63, 2)
    // Recommended return: (1.0 * 12.5) = 12.5%
    expect(report.returnAnalysis.recommendedPortfolio3YrReturn).toBeCloseTo(12.5, 2)
    
    // Alpha vs Benchmark: 1.875% -> rounded to 1.88%
    expect(report.returnAnalysis.alphaVsBenchmark).toBeCloseTo(1.88, 2)
    
    // Insights from GPT
    expect(report.consolidationInsight).toBe("The recommended portfolio consolidates overlapping funds to improve expected alpha while maintaining core strategy alignment.")
    
    // Verify DB insertion
    expect(dbMock.insert).toHaveBeenCalled()
  })
})
