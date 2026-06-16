import { describe, it, expect, vi } from 'vitest'
import { Vikram } from '../../lib/agents/vikram'
import { ClientRiskProfile } from '../../lib/agents/types/kiran-types'

// Mock Azure OpenAI
vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4oMini: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Please revise target dates.' } }]
          })
        }
      }
    })),
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0))
  }
})

// Mock DeliberationRoom
vi.mock('../../lib/deliberation/deliberation-room', () => {
  return {
    deliberationRoom: {
      publish: vi.fn()
    }
  }
})

describe('Vikram Achievability Unit Tests', () => {
  const mockRoom = { publish: vi.fn() } as any
  const mockMemory = {} as any
  const mockResearch = {} as any
  const mockDb = {} as any

  const clientRiskProfile: ClientRiskProfile = {
    profile_id: '00000000-0000-4000-8000-000000000001',
    client_id: '00000000-0000-4000-8000-000000000002',
    version: 1,
    assessed_at: new Date().toISOString(),
    age: 35,
    net_worth_tier: 'affluent',
    behavioural_risk_tolerance: 'MEDIUM',
    recommended_equity_range: [50, 70],
    recommended_debt_range: [20, 40],
    hedging_required: false,
    reasoning: 'Moderate risk client'
  }

  const vikram = new Vikram(mockRoom, mockMemory, mockResearch, mockDb)

  it('should return REVISED verdict with explanation when Required CAGR is 24%', async () => {
    const targetDate = new Date()
    targetDate.setFullYear(targetDate.getFullYear() + 1)

    const clientAnswers = {
      stated_goals: ['Retirement'],
      monthly_income_lakh: 5.0,
      answers: {},
      goals_data: [
        {
          goal_id: '00000000-0000-4000-8000-000000000003',
          goal_type: 'RETIREMENT',
          description: 'Dream retirement',
          target_corpus_lakh: 124,
          current_corpus_lakh: 100, // 24% CAGR
          monthly_sip_required_lakh: 0.5,
          target_date: targetDate.toISOString()
        }
      ]
    }

    const result = await vikram.assessGoals(clientAnswers, clientRiskProfile, '00000000-0000-4000-8000-000000000009')
    expect(result.achievability_verdict).toBe('REVISED')
    expect(result.revised_plan).toBeDefined()
    expect(result.goal_sequence_conflicts.some(c => c.includes('24.0% is UNREALISTIC'))).toBe(true)
  })

  it('should return ACHIEVABLE verdict when Required CAGR is 12% over 15 years', async () => {
    const targetDate = new Date()
    targetDate.setFullYear(targetDate.getFullYear() + 15)

    const targetCorpus = 10 * Math.pow(1.12, 15)

    const clientAnswers = {
      stated_goals: ['Wealth Creation'],
      monthly_income_lakh: 5.0,
      answers: {},
      goals_data: [
        {
          goal_id: '00000000-0000-4000-8000-000000000004',
          goal_type: 'WEALTH_CREATION',
          description: 'Long term compounding',
          target_corpus_lakh: targetCorpus,
          current_corpus_lakh: 10,
          monthly_sip_required_lakh: 0.2,
          target_date: targetDate.toISOString()
        }
      ]
    }

    const result = await vikram.assessGoals(clientAnswers, clientRiskProfile, '00000000-0000-4000-8000-000000000009')
    expect(result.achievability_verdict).toBe('ACHIEVABLE')
    expect(result.goal_sequence_conflicts.length).toBe(0)
  })

  it('should return IMPOSSIBLE verdict when Required CAGR is 22% but required SIP is > 100% of income', async () => {
    const targetDate = new Date()
    targetDate.setFullYear(targetDate.getFullYear() + 1)

    const clientAnswers = {
      stated_goals: ['Retirement'],
      monthly_income_lakh: 1.0,
      answers: {},
      goals_data: [
        {
          goal_id: '00000000-0000-4000-8000-000000000005',
          goal_type: 'RETIREMENT',
          description: 'Short term retirement',
          target_corpus_lakh: 122,
          current_corpus_lakh: 100, // CAGR = 22%
          monthly_sip_required_lakh: 1.5, // SIP = 1.5L (> 1.0L income)
          target_date: targetDate.toISOString()
        }
      ]
    }

    const result = await vikram.assessGoals(clientAnswers, clientRiskProfile, '00000000-0000-4000-8000-000000000009')
    expect(result.achievability_verdict).toBe('IMPOSSIBLE')
    expect(result.goal_sequence_conflicts.some(c => c.includes('exceeds 100% of stated income'))).toBe(true)
  })

  it('should flag as UNREALISTIC when Monthly SIP > 60% of income', async () => {
    const targetDate = new Date()
    targetDate.setFullYear(targetDate.getFullYear() + 10)

    const clientAnswers = {
      stated_goals: ['Wealth Creation'],
      monthly_income_lakh: 2.0,
      answers: {},
      goals_data: [
        {
          goal_id: '00000000-0000-4000-8000-000000000006',
          goal_type: 'WEALTH_CREATION',
          description: 'Aggressive accumulation',
          target_corpus_lakh: 100,
          current_corpus_lakh: 40,
          monthly_sip_required_lakh: 1.3,
          target_date: targetDate.toISOString()
        }
      ]
    }

    const result = await vikram.assessGoals(clientAnswers, clientRiskProfile, '00000000-0000-4000-8000-000000000009')
    expect(result.goal_sequence_conflicts.some(c => c.includes('exceeds 60% of stated income'))).toBe(true)
  })

  it('should populate goal_sequence_conflicts when Retirement date is before child education date', async () => {
    const retirementDate = new Date()
    retirementDate.setFullYear(retirementDate.getFullYear() + 5)

    const educationDate = new Date()
    educationDate.setFullYear(educationDate.getFullYear() + 10)

    const clientAnswers = {
      stated_goals: ['Retirement', 'Child Education'],
      monthly_income_lakh: 5.0,
      answers: {},
      goals_data: [
        {
          goal_id: '00000000-0000-4000-8000-000000000007',
          goal_type: 'RETIREMENT',
          description: 'Retirement goal',
          target_corpus_lakh: 100,
          current_corpus_lakh: 50,
          monthly_sip_required_lakh: 0.5,
          target_date: retirementDate.toISOString()
        },
        {
          goal_id: '00000000-0000-4000-8000-000000000008',
          goal_type: 'CHILD_EDUCATION',
          description: 'Child education goal',
          target_corpus_lakh: 100,
          current_corpus_lakh: 50,
          monthly_sip_required_lakh: 0.5,
          target_date: educationDate.toISOString()
        }
      ]
    }

    const result = await vikram.assessGoals(clientAnswers, clientRiskProfile, '00000000-0000-4000-8000-000000000009')
    expect(result.goal_sequence_conflicts.some(c => c.includes('Goal Sequence Conflict: Retirement target date is set earlier than Child Education'))).toBe(true)
  })
})
