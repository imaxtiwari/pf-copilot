import { describe, it, expect, vi } from 'vitest'
import { Aria } from '../../lib/agents/aria'
import { CritiqueFault } from '../../lib/agents/types/aria-types'

// Mock DeliberationRoom and AgentMemoryStore
vi.mock('../../lib/deliberation/deliberation-room')
vi.mock('../../lib/memory/memory-store')

describe('Aria Critique Unit Tests', () => {
  const mockRoom = { publish: vi.fn().mockResolvedValue({}) } as any
  const mockMemory = { recall: vi.fn().mockResolvedValue([]), write: vi.fn().mockResolvedValue('id') } as any
  const mockResearch = {} as any
  const mockDb = {} as any

  const aria = new Aria(mockRoom, mockMemory, mockResearch, mockDb)

  it('should raise CONCENTRATION fault for a portfolio with 80% in one AMC', async () => {
    const draft = {
      draft_version: 1,
      portfolio_id: 'p-1',
      client_id: 'c-1',
      notes: 'AMC_80_PERCENT_MOCK'
    }

    const report = await aria.critiquePortfolioDraft(draft, { message_id: 'msg-1', client_id: 'c-1' }, 'run-1')
    expect(report.critical_count).toBe(1)
    expect(report.faults[0].fault_category).toBe('CONCENTRATION')
    expect(report.faults[0].severity).toBe('CRITICAL')
  })

  it('should raise RECENCY_BIAS fault when 1-year return is used as primary selection criterion', async () => {
    const draft = {
      draft_version: 1,
      portfolio_id: 'p-2',
      client_id: 'c-1',
      notes: "selection_criterion: '1-year return'"
    }

    const report = await aria.critiquePortfolioDraft(draft, { message_id: 'msg-2', client_id: 'c-1' }, 'run-2')
    expect(report.critical_count).toBe(1)
    expect(report.faults[0].fault_category).toBe('RECENCY_BIAS')
    expect(report.faults[0].severity).toBe('CRITICAL')
  })

  it('should have correct critique counts for a portfolio with 0 CRITICAL faults', async () => {
    const draft = {
      draft_version: 1,
      portfolio_id: 'p-3',
      client_id: 'c-1',
      notes: 'no_faults_portfolio'
    }

    const report = await aria.critiquePortfolioDraft(draft, { message_id: 'msg-3', client_id: 'c-1' }, 'run-3')
    expect(report.critical_count).toBe(0)
    expect(report.major_count).toBe(0)
    expect(report.minor_count).toBe(0)
    expect(report.faults).toHaveLength(0)
  })

  it('should change severity level (downgrade) when respondToCounterArgument is called with valid new evidence', async () => {
    const originalFault: CritiqueFault = {
      fault_id: '00000000-0000-4000-8000-000000000010',
      fault_category: 'CONCENTRATION',
      fault_description: 'Overweight in AMC.',
      evidence_sources: [],
      severity: 'CRITICAL',
      suggested_remedy: 'Diversify.',
      confidence_tier: 'VERIFIED',
      from_fault_library: false
    }

    const updated = await aria.respondToCounterArgument(originalFault, 'We present new compliance report evidence showing safety.', 'run-4')
    expect(updated.severity).toBe('MINOR')
    expect(updated.fault_description).toContain('mitigated')
  })

  it('should maintain severity level when respondToCounterArgument is called without new evidence', async () => {
    const originalFault: CritiqueFault = {
      fault_id: '00000000-0000-4000-8000-000000000010',
      fault_category: 'CONCENTRATION',
      fault_description: 'Overweight in AMC.',
      evidence_sources: [],
      severity: 'CRITICAL',
      suggested_remedy: 'Diversify.',
      confidence_tier: 'VERIFIED',
      from_fault_library: false
    }

    const updated = await aria.respondToCounterArgument(originalFault, 'We just want to keep it as it is because we like it.', 'run-5')
    expect(updated.severity).toBe('CRITICAL')
    expect(updated.suggested_remedy).toContain('multiple AMCs')
  })
})
