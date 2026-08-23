import { describe, it, expect } from 'vitest'

// buildContextWindow was removed from the orchestrator when token-budget logic
// was inlined into the chat route. This test file is kept as a placeholder but
// skipped until the function is re-exposed or the budget logic is re-tested
// through the route's unit tests.

describe('Token Budget Context Unit Tests', () => {
  it.skip('placeholder - buildContextWindow no longer exported from orchestrator', () => {
    expect(true).toBe(true)
  })
})
