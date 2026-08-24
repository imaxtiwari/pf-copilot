import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOrchestrator, CostBudgetExceededError, DEFAULT_ORCHESTRATOR_CONFIG } from '@/lib/orchestrator'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
process.env.AZURE_OPENAI_API_KEY = 'test-key'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'test-deployment'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O = 'test-deployment'

vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
  },
}))

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

function makeCompletion(content: string, totalTokens: number) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: Math.ceil(totalTokens / 2), completion_tokens: Math.floor(totalTokens / 2), total_tokens: totalTokens },
  }
}

describe('Orchestrator token budget', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes normally when cumulative tokens stay within budget', async () => {
    // Tool call first, then final answer.
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 },
      })
      .mockResolvedValueOnce(makeCompletion('Final answer.', 200))

    const result = await runOrchestrator('user-1', 'hello', 'en', { maxTokensPerTurn: 500 })
    expect(result.assistant_message).toBe('Final answer.')
    expect(result.refusal_reason).toBeNull()
  })

  it('throws CostBudgetExceededError when cumulative tokens exceed maxTokensPerTurn', async () => {
    mockCreate.mockImplementation(async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 150, completion_tokens: 150, total_tokens: 300 },
    }))

    await expect(runOrchestrator('user-1', 'hello', 'en', { maxTokensPerTurn: 500 })).rejects.toThrow(CostBudgetExceededError)

    try {
      await runOrchestrator('user-1', 'hello', 'en', { maxTokensPerTurn: 500 })
    } catch (e) {
      expect(e).toBeInstanceOf(CostBudgetExceededError)
      expect((e as CostBudgetExceededError).cumulativeTokens).toBe(600)
      expect((e as CostBudgetExceededError).maxTokens).toBe(500)
    }
  })

  it('uses DEFAULT_ORCHESTRATOR_CONFIG when no config is provided', async () => {
    mockCreate.mockResolvedValue(makeCompletion('Default config answer.', 10))
    const result = await runOrchestrator('user-1', 'hello')
    expect(result.assistant_message).toBe('Default config answer.')
    expect(DEFAULT_ORCHESTRATOR_CONFIG.maxToolIterations).toBe(5)
    expect(DEFAULT_ORCHESTRATOR_CONFIG.maxTokensPerTurn).toBe(4000)
  })

  it('respects a lower maxToolIterations override', async () => {
    mockCreate.mockImplementation(async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_portfolio', arguments: '{}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))

    const result = await runOrchestrator('user-1', 'hello', 'en', { maxToolIterations: 1 })
    // After one iteration with tool_calls and no final answer, we hit max iterations fallback.
    expect(result.refusal_reason).toBe('contract_violation')
    expect(result.assistant_message).toBe('I got stuck working through your question. Could you rephrase?')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
