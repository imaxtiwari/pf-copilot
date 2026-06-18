import { describe, it, expect, vi } from 'vitest'
import { resolveVote, CommitteeVote } from '@/lib/agents/dhruv'

describe('ARIA Critical Block Unit Tests', () => {
  const dummyDhruv = { castDecidingVote: vi.fn() } as any
  const dummyDraft = {} as any

  it('CRITICAL fault from ARIA -> pipeline_state transitions to REJECT', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: 'critical fault' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    // hasCritical = true
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, true, 85)
    expect(result.outcome).toBe('REJECTED')
    expect(result.outcomeReason).toContain('Rejected automatically due to CRITICAL critique faults from ARIA')
  })

  it('MAJOR fault from ARIA -> pipeline proceeds to COMMITTEE_VOTE', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: 'major fault' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    // hasCritical = false
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('Zero faults from ARIA -> pipeline proceeds to COMMITTEE_VOTE', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    // hasCritical = false
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('no path exists from ARIA_CRITICAL to APPROVED', async () => {
    // Even if everyone else approves, if ARIA has critical fault, it rejects.
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: 'critical fault' },
      { voter: 'KIRAN', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, true, 100)
    expect(result.outcome).not.toBe('APPROVED')
    expect(result.outcome).toBe('REJECTED')
  })
})
