import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyAssistantOutput,
  ADVICE_DETECTED_REFUSAL,
} from '@/lib/safety/classifier'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
process.env.AZURE_OPENAI_API_KEY = 'test-key'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'test-deployment'

const mockCreate = vi.fn()

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: () => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }),
}))

function makeClassifierResponse(label: 'safe' | 'borderline' | 'advice', score: number, reasoning: string) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ label, score, reasoning }),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }
}

describe('classifyAssistantOutput', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    delete process.env.SAFETY_CLASSIFIER_ENABLED
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns safe when the classifier labels the message safe', async () => {
    mockCreate.mockResolvedValueOnce(makeClassifierResponse('safe', 0.95, 'No prescriptive language.'))

    const result = await classifyAssistantOutput('The expense ratio is 1.42%.')

    expect(result.label).toBe('safe')
    expect(result.score).toBe(0.95)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('returns borderline when the classifier labels the message borderline', async () => {
    mockCreate.mockResolvedValueOnce(makeClassifierResponse('borderline', 0.72, 'Uses soft guidance.'))

    const result = await classifyAssistantOutput('This fund looks attractive for long-term investors.')

    expect(result.label).toBe('borderline')
    expect(result.score).toBe(0.72)
  })

  it('returns advice when the classifier labels the message advice', async () => {
    mockCreate.mockResolvedValueOnce(makeClassifierResponse('advice', 0.91, 'Explicit buy recommendation.'))

    const result = await classifyAssistantOutput('You should buy HDFC Top 100 Fund right now.')

    expect(result.label).toBe('advice')
    expect(result.score).toBe(0.91)
  })

  it('defaults to safe when the classifier returns non-JSON', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] })

    const result = await classifyAssistantOutput('Some message.')

    expect(result.label).toBe('safe')
    expect(result.score).toBe(1)
  })

  it('defaults to safe when the classifier returns an invalid schema', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ label: 'bad', score: 2 }) } }] })

    const result = await classifyAssistantOutput('Some message.')

    expect(result.label).toBe('safe')
    expect(result.score).toBe(1)
  })

  it('defaults to safe when the LLM call throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM timeout'))

    const result = await classifyAssistantOutput('Some message.')

    expect(result.label).toBe('safe')
    expect(result.score).toBe(1)
  })

  it('short-circuits to safe when SAFETY_CLASSIFIER_ENABLED=false', async () => {
    process.env.SAFETY_CLASSIFIER_ENABLED = 'false'

    const result = await classifyAssistantOutput('You should buy this fund.')

    expect(result.label).toBe('safe')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('ADVICE_DETECTED_REFUSAL', () => {
  it('matches the no-advice clause language', () => {
    expect(ADVICE_DETECTED_REFUSAL).toContain("investment recommendation")
    expect(ADVICE_DETECTED_REFUSAL).toContain("I can't make")
    expect(ADVICE_DETECTED_REFUSAL).not.toContain('should buy')
  })
})
