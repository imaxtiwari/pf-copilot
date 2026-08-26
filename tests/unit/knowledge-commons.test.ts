import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KnowledgeCommons, WeeklyLearning } from '@/lib/research/knowledge-commons'
import { db } from '@/lib/db'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'

vi.mock('@/lib/azure-openai', () => ({
  getEmbedding: vi.fn(async (text: string) => [0.1, 0.2, 0.3]),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: { KNOWLEDGE_COMMONS_WRITE: 'KNOWLEDGE_COMMONS_WRITE' },
}))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const publishMock = vi.fn(async () => undefined)

function makeChain(rows: unknown[] = []) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => unknown) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit', 'insert', 'values']) {
    chain[method] = () => chain
  }
  return chain
}

function makeMockDb() {
  return {
    select: vi.fn(() => makeChain([])),
    insert: vi.fn(() => makeChain([])),
  }
}

describe('KnowledgeCommons', () => {
  const room = new DeliberationRoom()
  room.bind = vi.fn(() => ({ publish: publishMock })) as any
  const commons = new KnowledgeCommons(room)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(db, makeMockDb())
  })

  it('contributes a sourced learning', async () => {
    const learning: WeeklyLearning = {
      summary: 'Equity markets rallied on strong earnings.',
      source_urls: ['https://example.com/news'],
      tags: ['macro'],
      agent: 'DHRUV',
    }

    await commons.contribute('DHRUV', learning)

    expect(db.insert).toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('rejects unsourced learnings', async () => {
    const learning: WeeklyLearning = {
      summary: 'Unsourced claim',
      source_urls: [],
      tags: [],
      agent: 'DHRUV',
    }

    await expect(commons.contribute('DHRUV', learning)).rejects.toThrow('unsourced')
  })

  it('queries commons and maps rows', async () => {
    const mockDb = makeMockDb()
    mockDb.select = vi.fn(() =>
      makeChain([
        {
          summary: 'Rates are expected to hold.',
          sourceUrl: 'https://example.com/rates',
          payload: { source_urls: ['https://example.com/rates'] },
          tags: ['rates'],
          agentId: 'KIRAN',
          memoryType: 'WEEKLY_LEARNING',
        },
      ]),
    )
    Object.assign(db, mockDb)

    const results = await commons.queryCommons('KIRAN', 'interest rates outlook')

    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('Rates are expected to hold.')
    expect(results[0].agent).toBe('KIRAN')
  })

  it('returns recent contributions', async () => {
    const mockDb = makeMockDb()
    mockDb.select = vi.fn(() =>
      makeChain([
        {
          summary: 'Recent learning',
          sourceUrl: 'internal://memo/1',
          payload: null,
          tags: ['memo'],
          agentId: 'DHRUV',
          memoryType: 'WEEKLY_LEARNING',
        },
      ]),
    )
    Object.assign(db, mockDb)

    const results = await commons.recent('DHRUV', 5)

    expect(results).toHaveLength(1)
    expect(results[0].source_urls).toEqual(['internal://memo/1'])
  })

  it('consolidates learnings and publishes a directive', async () => {
    await commons.consolidate(
      {
        DHRUV: [
          { summary: 'D1', source_urls: ['https://a.com'], tags: [], agent: 'DHRUV' },
        ],
        KIRAN: [
          { summary: 'K1', source_urls: ['https://b.com'], tags: [], agent: 'KIRAN' },
          { summary: 'Bad', source_urls: [], tags: [], agent: 'KIRAN' },
        ],
      },
      'run-1',
    )

    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'DHRUV',
        message_type: 'DIRECTIVE',
      }),
    )
  })
})
