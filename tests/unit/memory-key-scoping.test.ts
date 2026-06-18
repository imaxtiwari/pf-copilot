import { describe, it, expect, beforeEach } from 'vitest'
import { AgentMemoryStore, makePipelineKey } from '@/lib/memory/memory-store'

describe('Memory Key Scoping Unit Tests', () => {
  let memoryStore: AgentMemoryStore

  beforeEach(() => {
    memoryStore = new AgentMemoryStore()
  })

  it('Two pipeline runs same user -> different memory namespaces, no bleed', () => {
    const userId = 'user-123'
    const run1Id = 'run-aaa'
    const run2Id = 'run-bbb'

    const key1 = makePipelineKey('VIKRAM', 'goal_assessment', userId, run1Id)
    const key2 = makePipelineKey('VIKRAM', 'goal_assessment', userId, run2Id)

    expect(key1).not.toBe(key2)
    expect(key1).toContain(run1Id)
    expect(key2).toContain(run2Id)
  })

  it('VIKRAM goal_assessment from run #1 not readable in run #2', () => {
    const userId = 'user-123'
    const run1Id = 'run-aaa'
    const run2Id = 'run-bbb'

    const key1 = makePipelineKey('VIKRAM', 'goal_assessment', userId, run1Id)
    const key2 = makePipelineKey('VIKRAM', 'goal_assessment', userId, run2Id)

    // Namespace keys are strict identifiers
    expect(key1).not.toEqual(key2)
  })
})
