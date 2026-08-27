import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Mentor } from '@/lib/agents/mentor'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { getGpt4o } from '@/lib/azure-openai'

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

vi.mock('@/lib/research/knowledge-commons', () => ({
  KnowledgeCommons: vi.fn().mockImplementation(() => ({
    contribute: vi.fn(async () => undefined),
    queryCommons: vi.fn(async () => []),
  })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function makeMockDb() {
  const chain = (rows: unknown[] = []) => ({
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
    limit: function (n: number) {
      return this
    },
    orderBy: function () {
      return this
    },
    where: function () {
      return this
    },
    from: function () {
      return this
    },
    select: function () {
      return this
    },
  })

  return {
    select: vi.fn(() => chain()),
  }
}

function gptResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

describe('Mentor', () => {
  const room = new DeliberationRoom()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts learnings from a completed pipeline run', async () => {
    const db = makeMockDb()
    const mentor = new Mentor(room, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              learnings: [
                { agent: 'ARIA', learning: 'ARIA should flag concentration earlier.', tags: ['concentration'] },
                { agent: 'PRIYA', learning: 'PRIYA should tighten overlap checks.', tags: ['overlap'] },
              ],
            }),
          ),
        },
      },
    } as any)

    const learnings = await mentor.runPostPipelineAnalysis(RUN_ID, 'APPROVED')

    expect(learnings).toHaveLength(2)
    expect(learnings[0].agent).toBe('ARIA')
    expect(learnings[1].learning).toContain('overlap')
  })

  it('returns empty array when no learnings are generated', async () => {
    const db = makeMockDb()
    const mentor = new Mentor(room, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({ learnings: [] })),
        },
      },
    } as any)

    const learnings = await mentor.runPostPipelineAnalysis(RUN_ID, 'DEADLOCKED')

    expect(learnings).toHaveLength(0)
  })
})
