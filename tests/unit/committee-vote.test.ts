import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Dhruv } from '@/lib/agents/dhruv'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { getGpt4o } from '@/lib/azure-openai'
import { CommitteeVoteRecordSchema } from '@/lib/agents/types'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
  makePipelineKey: vi.fn((a: string, k: string, u: string, r: string) => `${a}:${k}:${u}:${r}`),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function gptResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

function makeDraft(overrides: Partial<any> = {}): any {
  return {
    portfolio_id: 'p0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    client_id: CLIENT_ID,
    pipeline_run_id: RUN_ID,
    version: 1,
    revision_number: 0,
    goal_buckets: [],
    fund_allocations: [],
    hedge_instruments: {
      hedge_map_id: 'h1',
      client_id: CLIENT_ID,
      positions: [],
      overall_hedge_coverage_pct: 85,
    },
    confidence_score: {
      total: 80,
      breakdown: {
        data_freshness: 20,
        goal_achievability: 20,
        hedge_completeness: 20,
        critique_severity: 20,
        backtest_quality: 0,
      },
      blocking_reasons: [],
    },
    backtest_summary: {
      backtest_id: 'b1',
      period_years: 5,
      start_date: '2019-01-01',
      end_date: '2024-01-01',
      portfolio_cagr_pct: 12,
      benchmark_cagr_pct: 11,
      alpha_pct: 1,
      max_drawdown_pct: -15,
      max_drawdown_recovery_months: 6,
      sharpe_ratio: 0.8,
      sortino_ratio: 1.1,
      data_completeness_pct: 75,
      proxy_funds_used: [],
      scenario_overlay: {
        portfolio_id: 'p1',
        tested_at: new Date().toISOString(),
        scenarios: [],
      },
    },
    open_critique_items: [],
    overlap_flags: [],
    universe_filters_applied: [],
    status: 'DRAFT',
    ...overrides,
  }
}

function makeMockDb() {
  return {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  }
}

function makeWebTool() {
  return { research: vi.fn(async () => []) } as any
}

describe('Dhruv committee vote', () => {
  const room = new DeliberationRoom()
  const webTool = makeWebTool()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approves a clean draft by majority', async () => {
    const db = makeMockDb()
    const dhruv = new Dhruv(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              faults: [],
              overall_assessment: 'No issues for discussion.',
            }),
          ),
        },
      },
    } as any)

    const draft = makeDraft()
    const record = await dhruv.runCommitteeSession(draft, RUN_ID)

    expect(() => CommitteeVoteRecordSchema.parse(record)).not.toThrow()
    expect(record.outcome).toBe('APPROVED')
    expect(record.votes).toHaveLength(3)
  })

  it('rejects a draft with critical faults', async () => {
    const db = makeMockDb()
    const dhruv = new Dhruv(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () =>
            gptResponse({
              faults: [
                {
                  fault_category: 'CONCENTRATION',
                  fault_description: '80% in one sector.',
                  evidence_sources: [{ url: 'https://sebi.gov.in', excerpt_summary: 'Concentration note.' }],
                  severity: 'CRITICAL',
                  suggested_remedy: 'Diversify.',
                  confidence_tier: 'VERIFIED',
                },
              ],
              overall_assessment: 'Critical concentration for discussion.',
            }),
          ),
        },
      },
    } as any)

    const draft = makeDraft()
    const record = await dhruv.runCommitteeSession(draft, RUN_ID)

    expect(record.outcome).toBe('REJECTED')
    expect(record.critical_faults_from_aria).toBeGreaterThan(0)
  })

  it('deadlocks when hedge coverage is below threshold', async () => {
    const db = makeMockDb()
    const dhruv = new Dhruv(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({ faults: [], overall_assessment: 'Clean.' })),
        },
      },
    } as any)

    const draft = makeDraft({ hedge_instruments: { hedge_map_id: 'h1', client_id: CLIENT_ID, positions: [], overall_hedge_coverage_pct: 50 } })
    const record = await dhruv.runCommitteeSession(draft, RUN_ID)

    expect(record.outcome).toBe('REJECTED')
    expect(record.outcome_reason).toContain('hedge coverage')
  })
})
