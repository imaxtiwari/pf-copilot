import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentMemoryStore } from '../../lib/memory/memory-store'

// Mock OpenAI
vi.mock('../../lib/azure-openai', () => {
  return {
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0))
  }
})

// Mock Qdrant using an ES6 class
const mockPoints: any[] = []
vi.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: class MockQdrant {
      getCollections = vi.fn().mockResolvedValue({ collections: [] })
      createCollection = vi.fn().mockResolvedValue({})
      upsert = vi.fn().mockImplementation((collectionName, data) => {
        mockPoints.push(...data.points)
        return Promise.resolve({})
      })
      search = vi.fn().mockImplementation((collectionName, options) => {
        return Promise.resolve(
          mockPoints.map(p => ({
            id: p.id,
            payload: p.payload,
            score: 1.0
          }))
        )
      })
      setPayload = vi.fn().mockImplementation((collectionName, data) => {
        for (const pid of data.points) {
          const found = mockPoints.find(p => p.id === pid)
          if (found) {
            found.payload = { ...found.payload, ...data.payload }
          }
        }
        return Promise.resolve({})
      })
    }
  }
})

// Mock auditTrail
vi.mock('../../lib/audit/audit-trail', () => {
  return {
    auditTrail: {
      log: vi.fn()
    },
    AuditActionType: {
      MEMORY_WRITE: 'MEMORY_WRITE',
      MEMORY_READ: 'MEMORY_READ'
    }
  }
})

describe('Memory Store TTL Unit Tests', () => {
  const store = new AgentMemoryStore()
  const realDateNow = Date.now
  let offsetMs = 0

  beforeEach(() => {
    mockPoints.length = 0
    offsetMs = 0
    Date.now = () => realDateNow() + offsetMs
  })

  afterEach(() => {
    Date.now = realDateNow
  })

  function advanceTime(days: number) {
    offsetMs += days * 24 * 60 * 60 * 1000
  }

  it('should return a STALE warning prefix when TTL is exceeded', async () => {
    await store.write('KIRAN', {
      content: 'Interest rates might decline.',
      memory_type: 'KIRAN_MACRO_BULLETIN', // TTL = 7 days
      source_url: 'https://sebi.gov.in',
      confidence_tier: 'VERIFIED',
      tags: ['macro']
    })

    advanceTime(8) // past 7-day TTL

    const recalled = await store.recall('KIRAN', 'Interest rates', { include_stale: true })
    expect(recalled).toHaveLength(1)
    expect(recalled[0].status).toBe('STALE')
    expect(recalled[0].payload).toContain('[STALE — 8 days ago]')
  })

  it('should not return stale entries if include_stale is false (default)', async () => {
    await store.write('KIRAN', {
      content: 'Interest rates might decline.',
      memory_type: 'KIRAN_MACRO_BULLETIN', // TTL = 7 days
      source_url: 'https://sebi.gov.in',
      confidence_tier: 'VERIFIED',
      tags: ['macro']
    })

    advanceTime(8)

    const recalled = await store.recall('KIRAN', 'Interest rates', { include_stale: false })
    expect(recalled).toHaveLength(0)
  })

  it('should archive entries and not return them at all when 3x TTL is exceeded', async () => {
    await store.write('KIRAN', {
      content: 'Interest rates might decline.',
      memory_type: 'KIRAN_MACRO_BULLETIN', // TTL = 7 days, 3x = 21 days
      source_url: 'https://sebi.gov.in',
      confidence_tier: 'VERIFIED',
      tags: ['macro']
    })

    advanceTime(22) // past 21 days

    const recalled = await store.recall('KIRAN', 'Interest rates', { include_stale: true })
    expect(recalled).toHaveLength(0)
    expect(mockPoints[0].payload.status).toBe('ARCHIVED')
  })

  it('should always return ACTIVE for entries with Infinity TTL (e.g. DHRUV_COMMITTEE_VOTE)', async () => {
    await store.write('DHRUV', {
      content: 'Committee voted to approve portfolio.',
      memory_type: 'DHRUV_COMMITTEE_VOTE', // TTL = Infinity
      source_url: 'Deliberation',
      confidence_tier: 'VERIFIED',
      tags: ['vote']
    })

    advanceTime(1000) // advance time by 1000 days

    const recalled = await store.recall('DHRUV', 'voted', { include_stale: true })
    expect(recalled).toHaveLength(1)
    expect(recalled[0].status).toBe('ACTIVE')
    expect(recalled[0].payload).not.toContain('[STALE')
  })
})
