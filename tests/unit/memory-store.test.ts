// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { writeMemory, recallMemory, makePipelineKey } from '@/lib/memory/memory-store'

describe('Memory store', () => {
  beforeAll(() => {
    process.env.MOCK_LLM = 'true'
  })

  it('writes and recalls a memory entry', async () => {
    const key = makePipelineKey('SOMA', 'nav-data', 'user-1', 'run-1')
    const entry = await writeMemory('SOMA', key, {
      content: { nav: 123.45, scheme_code: 'INF209K01UN8' },
      memory_type: 'SOMA_NAV_DATA',
      source_url: 'https://amfiindia.com',
      confidence_tier: 'VERIFIED',
      tags: ['nav', 'soma'],
      pipeline_run_id: 'run-1',
    }, 'user-1')

    expect(entry._key).toBe(key)
    expect(entry.memory_type).toBe('SOMA_NAV_DATA')
    expect(entry.payload.user_id).toBe('user-1')

    const recalled = await recallMemory('SOMA', 'NAV data for INF209K01UN8', 'user-1', {
      pipeline_run_id: 'run-1',
      limit: 5,
    })

    expect(recalled.length).toBeGreaterThanOrEqual(1)
    expect(recalled[0]._key).toBe(key)
  })

  it('filters memories by user_id', async () => {
    const key = makePipelineKey('SOMA', 'filtered', 'user-2', 'run-2')
    await writeMemory('SOMA', key, {
      content: { note: 'private' },
      memory_type: 'SOMA_NAV_DATA',
      source_url: 'test',
      confidence_tier: 'INFERRED',
      tags: [],
    }, 'user-2')

    const recalled = await recallMemory('SOMA', 'private note', 'user-3', { limit: 5 })
    const found = recalled.find((m) => m._key === key)
    expect(found).toBeUndefined()
  })
})
