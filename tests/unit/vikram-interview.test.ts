import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Vikram } from '../../lib/agents/vikram'

// Variable to control mock GPT response
let mockGptResponse = '{}'

// Mock Azure OpenAI
vi.mock('../../lib/azure-openai', () => {
  return {
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

describe('Vikram Interview Extraction Unit Tests', () => {
  const mockRoom = { publish: vi.fn() } as any
  const mockMemory = {} as any
  const mockResearch = {} as any
  const mockDb = {} as any

  const vikram = new Vikram(mockRoom, mockMemory, mockResearch, mockDb)

  beforeEach(() => {
    mockGptResponse = '{}'
    vi.clearAllMocks()
  })

  it('should successfully extract structured answers via LLM when JSON is valid', async () => {
    mockGptResponse = JSON.stringify({
      monthly_income_lakh: 4.5,
      goals: [
        {
          goal_type: 'RETIREMENT',
          description: 'Sunset retirement fund',
          target_corpus_lakh: 150.0,
          current_corpus_lakh: 20.0,
          monthly_sip_required_lakh: 0.3,
          target_date: '2040-01-01'
        }
      ]
    })

    const rawAnswers = {
      'What is your monthly income?': 'My monthly income is 4.5 lakhs',
      'What are your goals?': 'I want to retire by 2040 with 150 lakhs.'
    }

    const result = await vikram.extractStructuredAnswers(rawAnswers, 'test-run-id')

    expect(result.monthly_income_lakh).toBe(4.5)
    expect(result.stated_goals).toEqual(['Sunset retirement fund'])
    expect(result.goals_data.length).toBe(1)
    expect(result.goals_data[0].goal_type).toBe('RETIREMENT')
    expect(result.goals_data[0].description).toBe('Sunset retirement fund')
    expect(result.goals_data[0].target_corpus_lakh).toBe(150.0)
    expect(result.goals_data[0].current_corpus_lakh).toBe(20.0)
    expect(result.goals_data[0].monthly_sip_required_lakh).toBe(0.3)
    expect(result.goals_data[0].target_date).toBe('2040-01-01')
  })

  it('should fallback to legacy regex extraction when LLM returns invalid JSON', async () => {
    mockGptResponse = 'invalid-json-response'

    const rawAnswers = {
      'What is your monthly income?': 'I earn about 3.2 lakhs a month',
      'What is your main financial goal?': 'Buying a house'
    }

    const result = await vikram.extractStructuredAnswers(rawAnswers, 'test-run-id')

    expect(result.monthly_income_lakh).toBe(3.2)
    expect(result.stated_goals).toEqual(['Buying a house'])
    expect(result.goals_data.length).toBe(1)
    expect(result.goals_data[0].goal_type).toBe('RETIREMENT')
    expect(result.goals_data[0].description).toBe('Buying a house')
    expect(result.goals_data[0].target_corpus_lakh).toBe(100.0)
  })

  it('should fallback to legacy regex extraction when LLM returns JSON missing monthly_income_lakh', async () => {
    mockGptResponse = JSON.stringify({
      goals: []
    })

    const rawAnswers = {
      'What is your monthly income?': 'I earn 2.5 lakhs per month',
      'What is your goal?': 'Retirement'
    }

    const result = await vikram.extractStructuredAnswers(rawAnswers, 'test-run-id')

    expect(result.monthly_income_lakh).toBe(2.5)
    expect(result.stated_goals).toEqual(['Retirement'])
  })
})
