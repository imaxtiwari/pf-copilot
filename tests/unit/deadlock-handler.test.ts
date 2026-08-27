import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeadlockHandler } from '@/lib/agents/dhruv/deadlock-handler'
import { getGpt4o } from '@/lib/azure-openai'

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: { PIPELINE_DEADLOCK: 'PIPELINE_DEADLOCK' },
}))

const mockCreate = vi.fn()
vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function makeDraft(overrides: Partial<any> = {}): any {
  return {
    portfolio_id: 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33',
    client_id: CLIENT_ID,
    pipeline_run_id: RUN_ID,
    version: 1,
    revision_number: 0,
    goal_buckets: [],
    fund_allocations: [],
    hedge_instruments: {
      hedge_map_id: 'h1',
      portfolio_id: 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33',
      generated_at: new Date().toISOString(),
      positions: [],
      overall_hedge_coverage_pct: 85,
      sources: [],
    },
    confidence_score: {
      total: 80,
      breakdown: { data_freshness: 20, goal_achievability: 20, hedge_completeness: 20, critique_severity: 20, backtest_quality: 0 },
      blocking_reasons: [],
    },
    backtest_summary: {
      backtest_id: 'b0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11',
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
      scenario_overlay: { portfolio_id: 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33', tested_at: new Date().toISOString(), scenarios: [] },
    },
    open_critique_items: [],
    overlap_flags: [],
    universe_filters_applied: [],
    status: 'DRAFT',
    ...overrides,
  }
}

function makeMockDb(rows: any[] = []) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => rows),
        })),
      })),
    })),
  }
}

function makeBoundRoom(history: any[] = []) {
  return {
    getHistory: vi.fn(async () => history),
    send: vi.fn(async () => 'msg-id'),
  }
}

function makeRoom(bound: any) {
  return { bind: vi.fn(() => bound) } as any
}

describe('DeadlockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockReset()
  })

  it('produces a deadlock report using the LLM compromise', async () => {
    const boundRoom = makeBoundRoom([
      { message_id: 'm1', message_type: 'CRITIQUE', sender: 'ARIA', content: 'Concern', payload: { critique_points: ['Concentration'], severity: 'MAJOR', recommended_action: 'Diversify' }, timestamp: new Date().toISOString() },
      { message_id: 'm2', message_type: 'VOTE', sender: 'KIRAN', content: 'Approve', payload: {}, timestamp: new Date().toISOString() },
    ])
    const db = makeMockDb([{ voter: 'KIRAN', vote: 'APPROVE', reasoning: '', criticalFaultsCount: 0, hedgeCoveragePct: 85, votedAt: new Date().toISOString() }])
    const handler = new DeadlockHandler(makeRoom(boundRoom), db)

    mockCreate.mockImplementation(async () => ({
      choices: [{ message: { content: JSON.stringify({ compromise_proposal: 'Reduce equity.', root_cause: 'Risk mismatch.', agent_objections: [{ agent: 'ARIA', objection_summary: 'Too risky.', unresolved_faults: [] }], recommended_action: 'Rebalance.' }) } }],
    }))

    const report = await handler.executeDeadlockProtocol(RUN_ID, [makeDraft()], {
      stage: 'COMMITTEE_VOTE',
      revisions: 3,
      impossibilityReason: 'Tie vote.',
      bestDraftId: 'd0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33',
      bestConfidence: 80,
      riskDisclosures: [],
    }, { goals: [] })

    expect(report.dhruv_compromise_proposal).toBe('Reduce equity.')
    expect(report.recommended_action).toBe('Rebalance.')
    expect(report.agent_objections).toHaveLength(1)
    expect(boundRoom.send).toHaveBeenCalled()
  })

  it('falls back when the LLM call fails', async () => {
    const boundRoom = makeBoundRoom([])
    const db = makeMockDb([])
    const handler = new DeadlockHandler(makeRoom(boundRoom), db)

    mockCreate.mockRejectedValue(new Error('LLM unavailable'))

    const report = await handler.executeDeadlockProtocol(RUN_ID, [makeDraft()], {
      stage: 'ARIA_PREFLIGHT',
      revisions: 2,
      impossibilityReason: 'Impossible constraints.',
    }, { goals: [] })

    expect(report.dhruv_compromise_proposal).toContain('No compromise could be reached')
    expect(report.recommended_action).toContain('Deploying fallback portfolio draft')
  })

  it('tolerates database errors when fetching votes', async () => {
    const boundRoom = makeBoundRoom([])
    const db = {
      select: vi.fn(() => {
        throw new Error('DB down')
      }),
    }
    const handler = new DeadlockHandler(makeRoom(boundRoom), db)

    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({}) } }] })

    const report = await handler.executeDeadlockProtocol(RUN_ID, [makeDraft()], {
      stage: 'SEBI_COMPLIANCE',
      revisions: 1,
      complianceBlockReason: 'Concentration.',
      mostProblematicGoal: 'Retirement',
      shortestGoalTimeline: 10,
    }, { goals: [] })

    expect(report.report_id).toBeDefined()
    expect(report.compromise_vote_outcome).toBe('ACCEPTED')
  })
})
