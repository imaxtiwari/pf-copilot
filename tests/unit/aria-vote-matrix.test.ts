import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { Aria, deriveARIAVote } from '@/lib/agents/aria'
import { getGpt4o } from '@/lib/azure-openai'
import { CritiqueFault, FaultCategorySchema } from '@/lib/agents/types'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
  makePipelineKey: vi.fn((agent: string, artifact: string, userId: string, runId: string) => `${agent}:${artifact}:${userId}:${runId}`),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4o: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

function makeFault(severity: CritiqueFault['severity'], category?: string): CritiqueFault {
  return {
    fault_id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    fault_category: (category || 'OTHER') as any,
    fault_description: 'Mock point for discussion.',
    evidence_sources: [{ url: 'https://sebi.gov.in', excerpt_summary: 'Mock evidence', retrieved_at: new Date().toISOString() }],
    severity,
    suggested_remedy: 'Discuss further.',
    confidence_tier: 'VERIFIED',
  }
}

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

function makeWebTool() {
  return { research: vi.fn(async () => []) } as any
}

describe('deriveARIAVote', () => {
  it('REJECTs when any CRITICAL fault exists', () => {
    const result = deriveARIAVote([makeFault('CRITICAL'), makeFault('MINOR')])
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('CRITICAL_FAULT')
  })

  it('REJECTs when any MAJOR fault exists', () => {
    const result = deriveARIAVote([makeFault('MAJOR'), makeFault('MINOR')])
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('MAJOR_FAULT')
  })

  it('REJECTs when MINOR faults exceed 3', () => {
    const result = deriveARIAVote([makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR')])
    expect(result.vote).toBe('REJECT')
    expect(result.decidingFactor).toBe('MINOR_ACCUMULATION')
  })

  it('APPROVEs when MINOR count is ≤ 3', () => {
    const result = deriveARIAVote([makeFault('MINOR'), makeFault('MINOR'), makeFault('MINOR')])
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('MINOR_ACCEPTABLE')
  })

  it('APPROVEs when only OBSERVATION faults exist', () => {
    const result = deriveARIAVote([makeFault('OBSERVATION')])
    expect(result.vote).toBe('APPROVE')
    expect(result.decidingFactor).toBe('CLEAN')
  })
})

describe('Aria', () => {
  const room = new DeliberationRoom()
  const webTool = makeWebTool()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses educational language in portfolio critique', async () => {
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) }
    const aria = new Aria(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({
            faults: [
              {
                fault_category: 'CONCENTRATION',
                fault_description: 'High allocation to one sector.',
                evidence_sources: [{ url: 'https://sebi.gov.in', excerpt_summary: 'Concentration note.' }],
                severity: 'MAJOR',
                suggested_remedy: 'Discuss sector diversification.',
                confidence_tier: 'INFERRED',
              },
            ],
            overall_assessment: 'One concern to discuss.',
          })),
        },
      },
    } as any)

    const draft = {
      portfolio_id: 'p0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      client_id: CLIENT_ID,
      pipeline_run_id: RUN_ID,
      version: 1,
      revision_number: 0,
      fund_allocations: [],
      goal_buckets: [],
    }

    const report = await aria.critiquePortfolioDraft(
      draft,
      { message_id: 'm1', client_id: CLIENT_ID },
      RUN_ID,
    )

    expect(report.faults).toHaveLength(1)
    expect(report.overall_assessment.toLowerCase()).toContain('discuss')
  })

  it('produces a valid PreflightReport', async () => {
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) }
    const aria = new Aria(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({
            predictedFailureModes: [
              {
                faultCategory: 'CONCENTRATION',
                severity: 'MAJOR',
                description: 'Likely to over-allocate to large-cap.',
                avoidanceGuidance: 'Check sector weights.',
              },
            ],
          })),
        },
      },
    } as any)

    const context = {
      userId: CLIENT_ID,
      pipelineRunId: RUN_ID,
      goalProfile: {
        assessment_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
        client_id: CLIENT_ID,
        version: 1,
        assessed_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        stated_goals: ['Retirement corpus'],
        decomposed_goals: [],
        achievability_verdict: 'ALIGNS_WITH_GOALS' as const,
        goal_sequence_conflicts: [],
        sources: [],
        hypothesis_mode: true,
        user_corrections: [],
        correction_rounds: 0,
      },
      clientRiskProfile: {
        profile_id: 'p0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
        client_id: CLIENT_ID,
        version: 1,
        generated_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        age: 35,
        years_to_goal: 20,
        income_stability_score: 7,
        existing_liabilities: null,
        dependants: 'kids' as const,
        emergency_fund_months: 6,
        insurance_coverage: 'Standard',
        tax_bracket_pct: 30,
        behavioural_risk_tolerance: 'MEDIUM' as const,
        stated_risk_tolerance: 'MEDIUM' as const,
        geographic_income_risk: 'metro',
        factors: [],
      },
      fundUniverse: {
        universe_id: 'u0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
        generated_at: new Date().toISOString(),
        pipeline_run_id: RUN_ID,
        filters_applied: [],
        eligible_funds: [],
        total_screened: 0,
        total_eligible: 0,
      },
    }

    const report = await aria.runPreflight(context)

    expect(report.predictedFailureModes).toHaveLength(1)
    expect(report.predictedFailureModes[0].faultCategory).toBe('CONCENTRATION')
    expect(() => FaultCategorySchema.parse(report.predictedFailureModes[0].faultCategory)).not.toThrow()
  })
})
