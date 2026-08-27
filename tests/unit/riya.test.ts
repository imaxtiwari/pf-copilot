import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { Riya, BehavioralFingerprint } from '@/lib/agents/riya'
import { getGpt4oMini } from '@/lib/azure-openai'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
  makePipelineKey: vi.fn((agent: string, artifact: string, userId: string, runId: string) => `${agent}:${artifact}:${userId}:${runId}`),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const USER_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function gptResponse(payload: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  }
}

function makeFingerprint(): BehavioralFingerprint {
  return {
    patterns: [
      {
        patternType: 'LOSS_AVERSION',
        severity: 'MEDIUM',
        evidence: 'Holds underperforming fund for 3 years.',
        implication: 'Discuss exit rules before drafting.',
      },
    ],
    riskToleranceReality: 'MATCHES_STATED',
    riskToleranceReasoning: 'Stated moderate risk aligns with chat tone.',
    portfolioAbandonmentRisk: 'LOW',
    abandonmentRiskReasoning: 'SIPs are consistent and panic language is absent.',
    constructionGuidance: ['Keep equity allocation within moderate range for discussion.'],
  }
}

function makeMockDb(rows: unknown[] = []) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'limit']) {
    chain[method] = () => chain
  }
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })) })),
  }
}

function makeWebTool() {
  return { research: vi.fn(async () => []) } as any
}

describe('Riya', () => {
  const room = new DeliberationRoom()
  const webTool = makeWebTool()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates and saves a BehavioralFingerprint', async () => {
    const db = makeMockDb()
    const riya = new Riya(room, webTool, db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(makeFingerprint())),
        },
      },
    } as any)

    const fingerprint = await riya.getOrGenerateFingerprint({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      goalHypothesisCorrections: [],
      chatHistory: [{ role: 'user', content: 'I worry when markets fall.' }],
      existingHoldings: [{ scheme_code: 'FUND001', value: 500000 }],
    })

    expect(fingerprint.patterns).toHaveLength(1)
    expect(fingerprint.patterns[0].patternType).toBe('LOSS_AVERSION')
    expect(fingerprint.portfolioAbandonmentRisk).toBe('LOW')
    expect(fingerprint.constructionGuidance.length).toBeGreaterThan(0)
  })

  it('returns a cached fingerprint from the database', async () => {
    const cached = makeFingerprint()
    const db = makeMockDb([{ fingerprint: cached }])
    const riya = new Riya(room, webTool, db)

    const fingerprint = await riya.getOrGenerateFingerprint({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      goalHypothesisCorrections: [],
    })

    expect(fingerprint).toEqual(cached)
  })

  it('does not persist raw chat text beyond the inferred fingerprint', async () => {
    const db = makeMockDb()
    const riya = new Riya(room, webTool, db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse(makeFingerprint())),
        },
      },
    } as any)

    await riya.getOrGenerateFingerprint({
      userId: USER_ID,
      pipelineRunId: RUN_ID,
      goalHypothesisCorrections: [],
      chatHistory: [{ role: 'user', content: 'Very sensitive personal detail.' }],
    })

    const { writeMemory } = await import('@/lib/memory/memory-store')
    const memoryCall = vi.mocked(writeMemory).mock.calls[0]
    const content = JSON.stringify(memoryCall[2].content)
    expect(content).not.toContain('Very sensitive personal detail')
  })
})
