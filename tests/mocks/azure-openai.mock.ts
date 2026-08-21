import { vi } from 'vitest'
import { mockChatCompletion as mockChatImpl, mockEmbedding as mockEmbedImpl } from '../../lib/azure-openai-mock-impl'

export const mockChatCompletion = mockChatImpl
export const mockEmbedding = mockEmbedImpl

export function setupAzureOpenAiMock() {
  vi.mock('@/lib/azure-openai', () => {
    return {
      getGpt4o: vi.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async (params) => {
              const content = mockChatImpl('gpt-4o', params.messages)
              return {
                choices: [{ message: { content } }],
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
              }
            })
          }
        }
      })),
      getGpt4oMini: vi.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async (params) => {
              const content = mockChatImpl('gpt-4o-mini', params.messages)
              return {
                choices: [{ message: { content } }],
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
              }
            })
          }
        }
      })),
      getEmbedding: vi.fn().mockImplementation(async (text: string) => {
        return Array.from(mockEmbedImpl(text))
      })
    }
  })
}
