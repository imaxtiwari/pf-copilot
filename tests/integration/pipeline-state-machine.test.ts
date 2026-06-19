import { describe, it, expect } from 'vitest'
import { PipelineStateMachine } from '../../lib/pipeline/pipeline-state-machine'
import { auditTrail, AuditActionType } from '../../lib/audit/audit-trail'

// Setup in-memory SQLite database for audit trail logs
process.env.AUDIT_TRAIL_DB_PATH = ':memory:'

describe('Pipeline State Machine Integration Tests', () => {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([])
        })
      })
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve({})
      })
    })
  } as any

  it('should allow legal transition PRIYA_BUILD -> DELIBERATION and write to audit trail', async () => {
    const runId = 'run-sm-1'
    const sm = new PipelineStateMachine(mockDb)

    await sm.transition('ONBOARDING', 'PROFILING_AND_GOAL_ASSESSMENT', runId)
    await sm.transition('PROFILING_AND_GOAL_ASSESSMENT', 'SOMA_FUND_UNIVERSE', runId)
    await sm.transition('SOMA_FUND_UNIVERSE', 'VIKRAM_STRATEGY', runId)
    await sm.transition('VIKRAM_STRATEGY', 'KIRAN_HEDGE_MAP', runId)
    await sm.transition('KIRAN_HEDGE_MAP', 'ARIA_PREFLIGHT', runId)
    await sm.transition('ARIA_PREFLIGHT', 'PRIYA_BUILD', runId)
    
    // Now test legal transition
    await expect(sm.transition('PRIYA_BUILD', 'DELIBERATION', runId)).resolves.not.toThrow()
    expect(sm.getCurrentStage(runId)).toBe('DELIBERATION')

    // Verify it was logged in audit trail
    const logs = auditTrail.query({ pipeline_run_id: runId, action_type: AuditActionType.PIPELINE_START })
    const matchedLog = logs.find(log => JSON.parse(log.payload_json).transition === 'PRIYA_BUILD -> DELIBERATION')
    expect(matchedLog).toBeDefined()
  })

  it('should throw error for illegal transition ONBOARDING -> COMMITTEE_VOTE', async () => {
    const runId = 'run-sm-2'
    const sm = new PipelineStateMachine(mockDb)

    await expect(
      sm.transition('ONBOARDING', 'COMMITTEE_VOTE', runId)
    ).rejects.toThrow('Illegal stage transition')
  })

  it('should block further transitions from terminal state DEADLOCKED', async () => {
    const runId = 'run-sm-3'
    const sm = new PipelineStateMachine(mockDb)

    // Transition to DEADLOCKED
    await sm.transition('ONBOARDING', 'PROFILING_AND_GOAL_ASSESSMENT', runId)
    await sm.transition('PROFILING_AND_GOAL_ASSESSMENT', 'SOMA_FUND_UNIVERSE', runId)
    await sm.transition('SOMA_FUND_UNIVERSE', 'VIKRAM_STRATEGY', runId)
    await sm.transition('VIKRAM_STRATEGY', 'KIRAN_HEDGE_MAP', runId)
    await sm.transition('KIRAN_HEDGE_MAP', 'ARIA_PREFLIGHT', runId)
    await sm.transition('ARIA_PREFLIGHT', 'PRIYA_BUILD', runId)
    await sm.transition('PRIYA_BUILD', 'DELIBERATION', runId)
    await sm.transition('DELIBERATION', 'COMMITTEE_VOTE', runId)
    await sm.transition('COMMITTEE_VOTE', 'DEADLOCKED', runId)

    expect(sm.getCurrentStage(runId)).toBe('DEADLOCKED')

    // DEADLOCKED is terminal, no allowed transitions from it
    await expect(
      sm.transition('DEADLOCKED', 'REVISION', runId)
    ).rejects.toThrow('Illegal stage transition')
  })
})
