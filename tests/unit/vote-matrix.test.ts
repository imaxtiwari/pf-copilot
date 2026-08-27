import { describe, it, expect } from 'vitest'
import { resolveVote, CommitteeVote } from '@/lib/agents/dhruv/vote-resolver'

function makeDraft(confidence = 80): any {
  return {
    portfolio_id: 'p1',
    client_id: 'c1',
    pipeline_run_id: 'r1',
    confidence_score: { total: confidence },
  }
}

const chair = {
  castDecidingVote: (draft: any) => ({
    outcome: draft.confidence_score.total >= 60 ? ('APPROVED' as const) : ('REJECTED' as const),
    outcomeReason: 'Chair tie-break.',
  }),
}

describe('resolveVote matrix', () => {
  it('APPROVED with 3 approvals and no critical/hedge issues', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(), false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('REJECTED with 1 approval and 2 rejects', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'REJECT', reasoning: '' },
      { voter: 'VIKRAM', vote: 'REJECT', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(), false, 85)
    expect(result.outcome).toBe('REJECTED')
  })

  it('REJECTED automatically with critical faults regardless of votes', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(), true, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('CRITICAL')
  })

  it('REJECTED automatically when hedge coverage is below 80%', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: '' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(), false, 50)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('hedge coverage')
  })

  it('DHRUV decides with 1 cast vote', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: '' },
      { voter: 'KIRAN', vote: 'ABSTAIN', reasoning: '' },
      { voter: 'VIKRAM', vote: 'ABSTAIN', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(70), false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('DEADLOCKED with 0 cast votes', () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'ABSTAIN', reasoning: '' },
      { voter: 'KIRAN', vote: 'ABSTAIN', reasoning: '' },
      { voter: 'VIKRAM', vote: 'ABSTAIN', reasoning: '' },
    ]
    const result = resolveVote(votes, chair, makeDraft(), false, 85)
    expect(result.outcome).toBe('DEADLOCKED')
    expect(result.skipRevisionCycles).toBe(true)
  })
})
