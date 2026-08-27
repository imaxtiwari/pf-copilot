import { PortfolioDraft } from '@/lib/agents/types'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'

export type VoteQuorum = '3_CAST' | '2_CAST' | '1_CAST' | '0_CAST'

export type CommitteeVote = {
  voter: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' | 'ERROR'
  reasoning: string
}

export type VoteResolution = {
  outcome: 'APPROVED' | 'REJECTED' | 'DEADLOCKED'
  outcomeReason: string
  skipRevisionCycles?: boolean
}

export interface VoteResolver {
  castDecidingVote(draft: PortfolioDraft): VoteResolution
}

/**
 * Resolve a committee vote according to DHRUV rules:
 * - CRITICAL faults → REJECTED
 * - Hedge coverage < 80% → REJECTED
 * - 2/3 majority → APPROVED
 * - 1 cast vote → chair decides
 * - 0 cast votes → DEADLOCKED
 */
export function resolveVote(
  votes: CommitteeVote[],
  chair: VoteResolver,
  draft: PortfolioDraft,
  hasCritical: boolean,
  hedgeCoverage: number,
): VoteResolution {
  const cast = votes.filter((v) => v.vote !== 'ABSTAIN' && v.vote !== 'ERROR')
  const quorum: VoteQuorum = `${Math.min(cast.length, 3)}_CAST` as VoteQuorum

  const majorityOf = (castVotes: CommitteeVote[]): VoteResolution => {
    if (hasCritical) {
      return { outcome: 'REJECTED', outcomeReason: 'Rejected automatically due to CRITICAL discussion points from ARIA.' }
    }
    if (hedgeCoverage < 80) {
      return { outcome: 'REJECTED', outcomeReason: `Rejected automatically because hedge coverage (${hedgeCoverage}%) is below 80%.` }
    }

    const approves = castVotes.filter((v) => v.vote === 'APPROVE').length
    const rejects = castVotes.filter((v) => v.vote === 'REJECT').length

    if (approves >= 2 || (castVotes.length === 2 && approves === 2)) {
      return { outcome: 'APPROVED', outcomeReason: `Approved by majority (${approves} approvals, ${rejects} rejections).` }
    }
    return { outcome: 'REJECTED', outcomeReason: `Rejected by majority (${approves} approvals, ${rejects} rejections).` }
  }

  switch (quorum) {
    case '3_CAST':
      return majorityOf(cast)
    case '2_CAST':
      return majorityOf(cast)
    case '1_CAST':
      auditTrail.log({
        pipeline_run_id: draft.pipeline_run_id || 'UNKNOWN',
        agent_id: 'DHRUV',
        action_type: AuditActionType.COMMITTEE_VOTE_RESULT,
        payload: { type: 'LOW_QUORUM_WARNING', cast, abstained: votes.length - cast.length },
      })
      return chair.castDecidingVote(draft)
    case '0_CAST':
      return { outcome: 'DEADLOCKED', outcomeReason: 'NO_QUORUM', skipRevisionCycles: true }
  }
}
