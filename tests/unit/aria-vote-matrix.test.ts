import { deriveARIAVote } from '../../lib/agents/aria'
import { CritiqueFault } from '../../lib/agents/types/aria-types'
import { randomUUID } from 'crypto'
import { describe, it, expect } from 'vitest'

function makeFault(severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION'): CritiqueFault {
  return {
    fault_id: randomUUID(),
    fault_category: 'OTHER',
    fault_description: 'Test fault description',
    evidence_sources: [],
    severity,
    confidence_tier: 'VERIFIED',
    from_fault_library: false
  }
}

describe('ARIA Vote Decision Matrix', () => {
  it('Any CRITICAL fault -> REJECT (CRITICAL_FAULT)', () => {
    const faults = [makeFault('CRITICAL')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('CRITICAL_FAULT')
  })

  it('Any MAJOR fault -> REJECT (MAJOR_FAULT)', () => {
    const faults = [makeFault('MAJOR')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('MAJOR_FAULT')
  })

  it('Both CRITICAL and MAJOR -> REJECT (CRITICAL_FAULT)', () => {
    const faults = [makeFault('MAJOR'), makeFault('CRITICAL')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('CRITICAL_FAULT')
  })

  it('MINOR fault count > 3 -> REJECT (MINOR_ACCUMULATION)', () => {
    const faults = [makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('MINOR_ACCUMULATION')
  })

  it('MINOR fault count <= 3 -> APPROVE (MINOR_ACCEPTABLE)', () => {
    const faults = [makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('MINOR_ACCEPTABLE')
  })

  it('Exactly 1 MINOR fault -> APPROVE (MINOR_ACCEPTABLE)', () => {
    const faults = [makeFault('MINOR')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('MINOR_ACCEPTABLE')
  })

  it('OBSERVATION only -> APPROVE (CLEAN)', () => {
    const faults = [makeFault('OBSERVATION')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('CLEAN')
  })

  it('Empty faults -> APPROVE (CLEAN)', () => {
    const result = deriveARIAVote([])
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('CLEAN')
  })

  it('Mix of MAJOR, MINOR, OBSERVATION -> REJECT (MAJOR_FAULT)', () => {
    const faults = [makeFault('MAJOR'), makeFault('MINOR'), makeFault('OBSERVATION')]
    const result = deriveARIAVote(faults)
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('MAJOR_FAULT')
  })
})
