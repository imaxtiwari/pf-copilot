import { describe, it, expect, vi } from 'vitest'
import { resolveVote, CommitteeVote } from '@/lib/agents/dhruv'
import { auditTrail } from '@/lib/audit/audit-trail'

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: {
    log: vi.fn()
  },
  AuditActionType: {
    COMMITTEE_VOTE_RESULT: 'COMMITTEE_VOTE_RESULT'
  }
}))

describe('Vote Matrix Unit Tests', () => {
  const dummyDhruv = { 
    castDecidingVote: vi.fn().mockResolvedValue({ outcome: 'APPROVED', outcomeReason: 'Dhruv tie-break' }) 
  } as any
  const dummyDraft = { pipeline_run_id: 'test-run' } as any

  it('3 votes, 2 APPROVE 1 REJECT -> APPROVED', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'KIRAN', vote: 'REJECT', reasoning: 'nope' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('3 votes, 1 APPROVE 2 REJECT -> REJECTED', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'REJECT', reasoning: 'nope' },
      { voter: 'KIRAN', vote: 'REJECT', reasoning: 'nope' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('REJECTED')
  })

  it('2 votes cast (1 ERROR), 2 APPROVE -> APPROVED', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'APPROVE', reasoning: 'ok' },
      { voter: 'KIRAN', vote: 'ERROR', reasoning: 'failed' },
      { voter: 'VIKRAM', vote: 'APPROVE', reasoning: 'ok' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('APPROVED')
  })

  it('1 vote cast -> LOW_QUORUM_WARNING in audit log, DHRUV decides', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'ERROR', reasoning: 'failed' },
      { voter: 'KIRAN', vote: 'ERROR', reasoning: 'failed' },
      { voter: 'VIKRAM', vote: 'REJECT', reasoning: 'nope' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(auditTrail.log).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ type: 'LOW_QUORUM_WARNING' })
    }))
    expect(dummyDhruv.castDecidingVote).toHaveBeenCalled()
    expect(result.outcome).toBe('APPROVED') // mocked to return APPROVED
  })

  it('0 votes cast -> DEADLOCK immediately, revision_cycle not incremented', async () => {
    const votes: CommitteeVote[] = [
      { voter: 'ARIA', vote: 'ERROR', reasoning: 'failed' },
      { voter: 'KIRAN', vote: 'ERROR', reasoning: 'failed' },
      { voter: 'VIKRAM', vote: 'ERROR', reasoning: 'failed' },
    ]
    const result = await resolveVote(votes, dummyDhruv, dummyDraft, false, 85)
    expect(result.outcome).toBe('DEADLOCKED')
    expect(result.skipRevisionCycles).toBe(true)
  })
})
