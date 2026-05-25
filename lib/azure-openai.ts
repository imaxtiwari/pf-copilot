import { AzureOpenAI } from 'openai'
import logger from './logger'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required environment variable: ${name}`)
  return val
}

function makeClient(deployment: string): AzureOpenAI {
  return new AzureOpenAI({
    endpoint: requireEnv('AZURE_OPENAI_ENDPOINT'),
    apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    deployment,
    timeout: 60_000,
    maxRetries: 2,
  })
}

export function getGpt4o(): AzureOpenAI {
  return makeClient(requireEnv('AZURE_OPENAI_DEPLOYMENT_GPT4O'))
}

export function getGpt4oMini(): AzureOpenAI {
  return makeClient(requireEnv('AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI'))
}

export async function getEmbedding(text: string): Promise<number[]> {
  const deployment = requireEnv('AZURE_OPENAI_DEPLOYMENT_EMBEDDING')
  const client = makeClient(deployment)
  const start = Date.now()
  try {
    const response = await client.embeddings.create({
      model: deployment,
      input: text,
    })
    const vector = response.data[0].embedding
    logger.info(
      { deployment, durationMs: Date.now() - start, tokensUsed: response.usage?.prompt_tokens },
      'embedding created',
    )
    return vector
  } catch (error) {
    logger.error(
      { deployment, durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) },
      'embedding failed',
    )
    throw error
  }
}
