import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOrchestrator } from '@/lib/orchestrator'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
process.env.AZURE_OPENAI_API_KEY = 'test-key'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'test-deployment'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O = 'test-deployment'

const dbInsertReturning = vi.fn().mockResolvedValue([{ id: 'msg-1' }])

vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: dbInsertReturning }) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
  },
}))

const mockCreate = vi.fn()
const mockClassifierCreate = vi.fn()

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: () => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }),
  getGpt4o: () => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }),
  getEmbedding: vi.fn(),
}))

vi.mock('@/lib/safety/classifier', () => ({
  classifyAssistantOutput: vi.fn((message: string) => mockClassifierCreate(message)),
  ADVICE_DETECTED_REFUSAL: 'REFUSAL_PLACEHOLDER',
}))

vi.mock('@/lib/tools/get-portfolio', () => ({
  getPortfolio: vi.fn().mockResolvedValue({ holdings: [], total_value: 0 }),
}))

vi.mock('@/lib/tools/compute-inflation', () => ({
  computePersonalInflationTool: vi.fn(),
}))

vi.mock('@/lib/tools/compute-real-returns', () => ({
  computeRealReturns: vi.fn(),
}))

vi.mock('@/lib/tools/lookup-chat-history', () => ({
  lookupChatHistory: vi.fn(),
}))

vi.mock('@/lib/tools/explain-fund', () => ({
  explainFundTool: vi.fn(),
}))

vi.mock('@/lib/tools/explain-stock', () => ({
  explainStockTool: vi.fn(),
}))

vi.mock('@/lib/tools/compare-funds', () => ({
  compareFundsTool: vi.fn(),
}))

function makeCompletion(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }
}

function makeClassifierResult(label: 'safe' | 'borderline' | 'advice', score: number) {
  return Promise.resolve({ label, score, reasoning: 'test' })
}

describe('Orchestrator safety classification', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockClassifierCreate.mockReset()
    dbInsertReturning.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delivers the original message when the classifier returns safe', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('Your portfolio is 60% equity.'))
    mockClassifierCreate.mockResolvedValueOnce(makeClassifierResult('safe', 0.95))

    const result = await runOrchestrator('user-1', 'What is my portfolio?', 'en')

    expect(result.assistant_message).toBe('Your portfolio is 60% equity.')
    expect(result.refusal_reason).toBeNull()
  })

  it('replaces the message with a refusal when the classifier returns advice', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('You should buy HDFC Top 100 Fund.'))
    mockClassifierCreate.mockResolvedValueOnce(makeClassifierResult('advice', 0.91))

    const result = await runOrchestrator('user-1', 'Should I buy HDFC Top 100?', 'en')

    expect(result.assistant_message).toBe('REFUSAL_PLACEHOLDER')
    expect(result.refusal_reason).toBe('advice_detected')
  })

  it('delivers borderline messages but flags them for review', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('This fund looks attractive for long-term investors.'))
    mockClassifierCreate.mockResolvedValueOnce(makeClassifierResult('borderline', 0.72))

    const result = await runOrchestrator('user-1', 'Tell me about this fund', 'en')

    expect(result.assistant_message).toBe('This fund looks attractive for long-term investors.')
    expect(result.refusal_reason).toBeNull()
  })
})
