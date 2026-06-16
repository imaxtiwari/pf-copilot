import { describe, it, expect, vi } from 'vitest'
import { determineCommitteeOutcome } from '../../lib/agents/dhruv'
import { Vikram } from '../../lib/agents/vikram'

vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4oMini: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  vote: 'REJECT',
                  reasoning: 'Equity allocation 85% exceeds guidance range 60–75%',
                  violations: ['Equity allocation 85% exceeds guidance range 60–75%']
                })
              }
            }]
          })
        }
      }
    }))
  }
})

describe('Committee Vote Outcome Unit Tests', () => {
  it('should approve with 3 APPROVE + 0 CRITICAL faults + hedge 85%', () => {
    const votes = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = determineCommitteeOutcome(votes, false, 85)
    expect(result.outcome).toBe('APPROVED')
    expect(result.outcomeReason).toContain('Approved by 2/3 majority')
  })

  it('should approve with 2 APPROVE + 0 CRITICAL faults + hedge 85% (majority)', () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = determineCommitteeOutcome(votes, false, 85)
    expect(result.outcome).toBe('APPROVED')
    expect(result.outcomeReason).toContain('Approved by 2/3 majority')
  })

  it('should reject with 1 APPROVE + 0 CRITICAL faults + hedge 85% (no majority)', () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'REJECT', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = determineCommitteeOutcome(votes, false, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('did not reach 2/3 majority')
  })

  it('should auto reject with 2 APPROVE + 1 CRITICAL fault from ARIA (CRITICAL veto)', () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = determineCommitteeOutcome(votes, true, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('Rejected automatically due to CRITICAL critique faults')
  })

  it('should auto reject if hedge_coverage is 79% regardless of votes', () => {
    const votes = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = determineCommitteeOutcome(votes, false, 79)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('Rejected automatically because hedge coverage (79%) is below 80%')
  })

  it('should verify PRIYA vote is not present in standard votes list (abstains)', () => {
    const standardVoters = ['ARIA', 'KIRAN', 'VIKRAM', 'DHRUV']
    expect(standardVoters).not.toContain('PRIYA')
  })

  it('should mock getGpt4oMini to return REJECT and violations', async () => {
    const mockRoom = { publish: vi.fn() } as any
    const mockMemory = {} as any
    const mockResearch = {} as any
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { schemeCode: '119551', schemeType: 'equity' }
      ])
    } as any

    const vikram = new Vikram(mockRoom, mockMemory, mockResearch, mockDb)

    const draft = {
      portfolio_id: '00000000-0000-4000-8000-000000000003',
      fund_allocations: [
        { scheme_code: '119551', allocation_pct: 85, fund_name: 'Equity Fund' }
      ]
    } as any

    const strategyFramework = {
      selected_frameworks: [{ name: 'Bucket Strategy' }],
      asset_allocation_guidance: {
        equity_pct_range: [60, 75],
        debt_pct_range: [20, 30],
        gold_pct_range: [5, 10],
        international_pct_range: [0, 10]
      }
    } as any

    const result = await vikram.evaluatePortfolioAlignment(draft, strategyFramework, 'pipeline-run-id')
    expect(result.vote).toBe('REJECT')
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]).toBe('Equity allocation 85% exceeds guidance range 60–75%')
    expect(mockRoom.publish).toHaveBeenCalled()
  })
})
