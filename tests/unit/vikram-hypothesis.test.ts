import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Vikram } from '../../lib/agents/vikram'

let mockGptResponse = '{}'

vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4o: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => ({
            choices: [{ message: { content: mockGptResponse } }]
          }))
        }
      }
    })),
    getGpt4oMini: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => ({
            choices: [{ message: { content: mockGptResponse } }]
          }))
        }
      }
    })),
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0))
  }
})

describe('Vikram Hypothesis-First Interview Unit Tests', () => {
  const mockRoom = { publish: vi.fn() } as any
  const mockMemory = { write: vi.fn(), recall: vi.fn().mockResolvedValue([]) } as any
  const mockResearch = {} as any
  const mockDb = {} as any

  const vikram = new Vikram(mockRoom, mockMemory, mockResearch, mockDb)

  beforeEach(() => {
    mockGptResponse = '{}'
    vi.clearAllMocks()
  })

  it('should successfully return 5 static questions', async () => {
    const questions = await vikram.askEssentialQuestions()
    expect(questions.length).toBe(5)
    expect(questions[0].id).toBe('age')
    expect(questions[4].id).toBe('risk_reaction')
  })

  it('should successfully generate hypothesis', async () => {
    mockGptResponse = JSON.stringify({
      hypothesis_id: '00000000-0000-4000-8000-000000000003',
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2036,
      goal_description: 'Accumulate wealth for standard requirements.',
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: 'ACHIEVABLE',
      assumed_expenses: {
        rent_lakh: 0.25,
        city_tier: 'Tier-1',
        dependents: 'none assumed'
      },
      risk_profile: 'MODERATE',
      strategy_framework: 'core-satellite',
      assumptions: [
        {
          field: 'Monthly Rent',
          value: '₹25,000/month',
          reasoning: 'Typical rent for a Tier-1 city.'
        }
      ],
      confidence: 80
    })

    const answers = {
      age: 30,
      monthly_take_home_lakh: 1.5,
      biggest_goal: 'Buy a home in 10 years',
      goal_timeline_years: 10,
      risk_reaction: 'B' as const
    }

    const hypothesis = await vikram.generateHypothesis(answers, { userId: 'user-1' }, 'test-run-id')
    expect(hypothesis.corpus_target_lakh).toBe(100)
    expect(hypothesis.required_cagr_pct).toBe(12.0)
    expect(hypothesis.risk_profile).toBe('MODERATE')
    expect(mockRoom.publish).toHaveBeenCalled()
    expect(mockMemory.write).toHaveBeenCalled()
  })

  it('should successfully apply corrections', async () => {
    mockGptResponse = JSON.stringify({
      hypothesis_id: '00000000-0000-4000-8000-000000000003',
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2036,
      goal_description: 'Accumulate wealth for standard requirements.',
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: 'ACHIEVABLE',
      assumed_expenses: {
        rent_lakh: 0.15,
        city_tier: 'Tier-1',
        dependents: 'none assumed'
      },
      risk_profile: 'MODERATE',
      strategy_framework: 'core-satellite',
      assumptions: [
        {
          field: 'Monthly Rent',
          value: '₹15,000/month',
          reasoning: 'Typical rent updated by user.'
        }
      ],
      confidence: 80
    })

    const baseHypothesis = {
      hypothesis_id: '00000000-0000-4000-8000-000000000003',
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2036,
      goal_description: 'Accumulate wealth for standard requirements.',
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: 'ACHIEVABLE' as const,
      assumed_expenses: {
        rent_lakh: 0.25,
        city_tier: 'Tier-1',
        dependents: 'none assumed'
      },
      risk_profile: 'MODERATE' as const,
      strategy_framework: 'core-satellite',
      assumptions: [
        {
          field: 'Monthly Rent',
          value: '₹25,000/month',
          reasoning: 'Typical rent for a Tier-1 city.'
        }
      ],
      confidence: 80
    }

    const corrected = await vikram.applyCorrections(baseHypothesis, ['Monthly Rent: was "₹25,000/month", now "₹15,000/month"'], 'test-run-id')
    expect(corrected.assumed_expenses.rent_lakh).toBe(0.15)
  })
})
