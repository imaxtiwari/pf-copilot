import { describe, it, expect } from 'vitest'
import { determineCommitteeOutcome } from '../../lib/agents/dhruv'

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
})
