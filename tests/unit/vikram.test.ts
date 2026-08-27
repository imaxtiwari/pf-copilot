import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { Vikram } from '@/lib/agents/vikram'
import { getGpt4o, getGpt4oMini } from '@/lib/azure-openai'
import { GoalHypothesisSchema, ClientGoalAssessmentSchema, StrategyFrameworkSchema, GoalHypothesis } from '@/lib/agents/types'

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
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'

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

function makeMockDb(rows: unknown[] = []) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  return { select: vi.fn(() => chain) }
}

function makeWebTool() {
  return { research: vi.fn(async () => []) } as any
}

describe('Vikram', () => {
  const room = new DeliberationRoom()
  const webTool = makeWebTool()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a GoalHypothesis that passes Zod validation', async () => {
    const db = makeMockDb()
    const vikram = new Vikram(room, webTool, db)

    vi.mocked(getGpt4o).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({
            hypothesis_id: '00000000-0000-4000-8000-000000000003',
            generated_at: new Date().toISOString(),
            corpus_target_lakh: 100,
            corpus_target_year: 2036,
            goal_description: 'Accumulate wealth for retirement.',
            monthly_sip_required_lakh: 0.5,
            current_monthly_savings_lakh: 0.3,
            required_cagr_pct: 12.0,
            cagr_feasibility: 'ACHIEVABLE',
            assumed_expenses: {
              rent_lakh: 0.25,
              city_tier: 'Tier-1',
              dependents: 'none assumed',
            },
            risk_profile: 'MODERATE',
            strategy_framework: 'core-satellite',
            assumptions: [
              { field: 'Monthly Rent', value: '₹25,000/month', reasoning: 'Typical Tier-1 rent.' },
              { field: 'Dependents', value: 'None', reasoning: 'Assumed single.' },
            ],
            confidence: 80,
          })),
        },
      },
    } as any)

    const answers = {
      age: 30,
      monthly_take_home_lakh: 1.5,
      biggest_goal: 'Retirement corpus',
      goal_timeline_years: 15,
      risk_reaction: 'B' as const,
    }

    const hypothesis = await vikram.generateHypothesis(answers, { client_id: CLIENT_ID }, RUN_ID)

    expect(() => GoalHypothesisSchema.parse(hypothesis)).not.toThrow()
    expect(hypothesis.risk_profile).toBe('MODERATE')
    expect(hypothesis.confidence).toBeGreaterThanOrEqual(40)
    expect(hypothesis.confidence).toBeLessThanOrEqual(100)
  })

  it('selects a StrategyFramework that passes Zod validation', async () => {
    const db = makeMockDb()
    const vikram = new Vikram(room, webTool, db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({
            selected_frameworks: [
              {
                name: 'Core-Satellite Framework',
                description: 'Puts 70% in low-cost index funds and 30% in active themes.',
                why_applicable: 'Matches moderate risk profile.',
                source_url: 'https://sebi.gov.in',
              },
            ],
            asset_allocation_guidance: {
              equity_pct_range: [60, 80],
              debt_pct_range: [10, 20],
              gold_pct_range: [5, 10],
              international_pct_range: [5, 10],
            },
          })),
        },
      },
    } as any)

    const riskProfile = {
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
    }

    const assessment = {
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
    }

    const framework = await vikram.selectStrategyFramework(riskProfile, assessment, RUN_ID)

    expect(() => StrategyFrameworkSchema.parse(framework)).not.toThrow()
    expect(framework.client_id).toBe(CLIENT_ID)
    expect(framework.selected_frameworks.length).toBeGreaterThan(0)
    expect(framework.asset_allocation_guidance.equity_pct_range).toHaveLength(2)
  })

  it('builds a ClientGoalAssessment that passes Zod validation', async () => {
    const db = makeMockDb()
    const vikram = new Vikram(room, webTool, db)

    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => gptResponse({
            assessment_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
            client_id: CLIENT_ID,
            version: 1,
            assessed_at: new Date().toISOString(),
            expires_at: new Date().toISOString(),
            stated_goals: ['Retirement corpus'],
            decomposed_goals: [
              {
                goal_id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
                goal_type: 'RETIREMENT',
                description: 'Retirement',
                target_corpus_lakh: 100,
                target_date: '2040-01-01',
                current_corpus_lakh: 10,
                monthly_sip_required_lakh: 0.5,
                required_cagr_pct: 12,
                inflation_adjusted_target_lakh: 120,
                inflation_rate_used_pct: 6,
              },
            ],
            achievability_verdict: 'ALIGNS_WITH_GOALS',
            goal_sequence_conflicts: [],
            sources: [{ url: 'https://sebi.gov.in', retrieved_at: new Date().toISOString() }],
          })),
        },
      },
    } as any)

    const hypothesis: GoalHypothesis = {
      hypothesis_id: '00000000-0000-4000-8000-000000000003',
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2040,
      goal_description: 'Accumulate wealth for retirement.',
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: 'ACHIEVABLE',
      assumed_expenses: { rent_lakh: 0.25, city_tier: 'Tier-1', dependents: 'none assumed' },
      risk_profile: 'MODERATE',
      strategy_framework: 'core-satellite',
      assumptions: [],
      confidence: 80,
    }

    const assessment = await vikram.buildClientGoalAssessment(hypothesis, { client_id: CLIENT_ID }, RUN_ID)

    expect(() => ClientGoalAssessmentSchema.parse(assessment)).not.toThrow()
    expect(assessment.client_id).toBe(CLIENT_ID)
    expect(assessment.decomposed_goals).toHaveLength(1)
    expect(assessment.hypothesis_mode).toBe(true)
  })
})
