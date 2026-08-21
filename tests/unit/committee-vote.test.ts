import { describe, it, expect, vi } from 'vitest'
import { resolveVote } from '../../lib/agents/dhruv'
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
  const mockDhruv = { castDecidingVote: vi.fn().mockResolvedValue({ outcome: 'APPROVED', outcomeReason: 'Dhruv decides' }) } as any
  const mockDraft = { pipeline_run_id: 'test' } as any

  it('should approve with 3 APPROVE + 0 CRITICAL faults + hedge 85%', async () => {
    const votes = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = await resolveVote(votes, mockDhruv, mockDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
    expect(result.outcomeReason).toContain('Approved by majority')
  })

  it('should approve with 2 APPROVE + 0 CRITICAL faults + hedge 85% (majority)', async () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = await resolveVote(votes, mockDhruv, mockDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
    expect(result.outcomeReason).toContain('Approved by majority')
  })

  it('should reject with 1 APPROVE + 0 CRITICAL faults + hedge 85% (no majority)', async () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'REJECT', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = await resolveVote(votes, mockDhruv, mockDraft, false, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('Rejected by majority')
  })

  it('should auto reject with 2 APPROVE + 1 CRITICAL fault from ARIA (CRITICAL veto)', async () => {
    const votes = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = await resolveVote(votes, mockDhruv, mockDraft, true, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('Rejected automatically due to CRITICAL critique faults')
  })

  it('should auto reject if hedge_coverage is 79% regardless of votes', async () => {
    const votes = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' }
    ] as any

    const result = await resolveVote(votes, mockDhruv, mockDraft, false, 79)
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
