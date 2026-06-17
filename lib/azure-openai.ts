import { AzureOpenAI } from 'openai'
import logger from './logger'
import { mockChatCompletion, mockEmbedding } from './azure-openai-mock-impl'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required environment variable: ${name}`)
  return val
}

function shouldMock(): boolean {
  return process.env.MOCK_LLM === 'true' || !process.env.AZURE_OPENAI_API_KEY
}

function makeMockClient(model: string): any {
  return {
    chat: {
      completions: {
        create: async (params: any) => {
          const content = mockChatCompletion(model, params.messages)
          return {
            choices: [
              {
                message: {
                  content
                }
              }
            ],
            usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
          }
        }
      }
    },
    embeddings: {
      create: async (params: any) => {
        const inputStr = typeof params.input === 'string' ? params.input : JSON.stringify(params.input)
        const vector = mockEmbedding(inputStr)
        const encoding_format = params.encoding_format
        
        if (encoding_format === 'base64') {
          const buf = Buffer.from(vector.buffer)
          return {
            data: [{ embedding: buf.toString('base64'), index: 0 }],
            usage: { prompt_tokens: 5, total_tokens: 5 }
          }
        }
        
        return {
          data: [{ embedding: Array.from(vector), index: 0 }],
          usage: { prompt_tokens: 5, total_tokens: 5 }
        }
      }
    }
  }
}

const clientCache = new Map<string, AzureOpenAI>()

function makeClient(deployment: string): AzureOpenAI {
  if (shouldMock()) {
    return makeMockClient(deployment) as unknown as AzureOpenAI
  }
  let client = clientCache.get(deployment)
  if (!client) {
    client = new AzureOpenAI({
      endpoint: requireEnv('AZURE_OPENAI_ENDPOINT'),
      apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
      deployment,
      timeout: 60_000,
      maxRetries: 5,
    })
    clientCache.set(deployment, client)
  }
  return client
}

export function getGpt4o(): AzureOpenAI {
  if (shouldMock()) {
    return makeMockClient('gpt-4o') as unknown as AzureOpenAI
  }
  return makeClient(requireEnv('AZURE_OPENAI_DEPLOYMENT_GPT4O'))
}

export function getGpt4oMini(): AzureOpenAI {
  if (shouldMock()) {
    return makeMockClient('gpt-4o-mini') as unknown as AzureOpenAI
  }
  return makeClient(requireEnv('AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI'))
}

export async function getEmbedding(text: string): Promise<number[]> {
  if (shouldMock()) {
    return Array.from(mockEmbedding(text))
  }
  const deployment = requireEnv('AZURE_OPENAI_DEPLOYMENT_EMBEDDING')
  const client = makeClient(deployment)
  const start = Date.now()
  
  const retries = 6
  let lastError: any

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: deployment,
        input: text,
      })
      const embeddingData = response.data[0].embedding
      let vector: number[]
      if (typeof embeddingData === 'string') {
        const buf = Buffer.from(embeddingData, 'base64')
        vector = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
      } else {
        vector = embeddingData
      }
      logger.info(
        { deployment, durationMs: Date.now() - start, tokensUsed: response.usage?.prompt_tokens, attempt },
        'embedding created',
      )
      return vector
    } catch (error) {
      lastError = error
      // Exponential delay: 1s, 2s, 4s, 8s, 16s...
      const delayMs = Math.pow(2, attempt - 1) * 1000
      logger.warn(
        { deployment, attempt, error: error instanceof Error ? error.message : String(error), nextRetryDelayMs: delayMs },
        'embedding attempt failed, retrying...',
      )
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  logger.error(
    { deployment, durationMs: Date.now() - start, error: lastError instanceof Error ? lastError.message : String(lastError) },
    'embedding failed after all retries',
  )
  throw lastError
}


