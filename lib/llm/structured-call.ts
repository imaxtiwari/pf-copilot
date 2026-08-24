import { z } from 'zod'
import type { AzureOpenAI } from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat'
import { POLICY } from '@/lib/config/policy'
import logger from '@/lib/logger'

export type StructuredCallOptions<T> = {
  client: AzureOpenAI
  model: string
  messages: ChatCompletionMessageParam[]
  schema: z.ZodType<T>
  schemaName: string
  schemaDescription?: string
  temperature?: number
  maxAttempts?: number
  /** Strict JSON Schema mode (additionalProperties: false required). */
  strict?: boolean
  /** Deterministic fallback returned when every attempt fails. */
  fallback: T
}

export class StructuredCallError extends Error {
  constructor(
    message: string,
    public readonly schemaName: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(message)
    this.name = 'StructuredCallError'
  }
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim()
  const fenceStart = trimmed.indexOf('```json')
  if (fenceStart !== -1) {
    const codeStart = fenceStart + '```json'.length
    const fenceEnd = trimmed.lastIndexOf('```')
    if (fenceEnd > codeStart) {
      return trimmed.slice(codeStart, fenceEnd).trim()
    }
  }
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.slice(3, -3).trim()
  }
  return trimmed
}

function parseRaw(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === '') return {}
  const cleaned = stripJsonFences(raw)
  return JSON.parse(cleaned)
}

/**
 * Calls an LLM with a Zod schema enforced via OpenAI/Azure `json_schema` mode.
 *
 * If parsing/validation fails, the call retries with exponential backoff up to
 * `maxAttempts`. If all attempts fail, the supplied deterministic `fallback`
 * is returned so the caller can degrade gracefully instead of crashing.
 */
export async function structuredCall<T>(options: StructuredCallOptions<T>): Promise<T> {
  const {
    client,
    model,
    messages,
    schema,
    schemaName,
    schemaDescription,
    temperature = 0,
    maxAttempts = POLICY.structuredOutput.maxAttempts,
    strict = true,
    fallback,
  } = options

  const jsonSchema = z.toJSONSchema(schema, { target: 'openAi' })

  const responseFormat = {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      description: schemaDescription,
      schema: jsonSchema,
      strict,
    },
  }

  let lastError: unknown
  const baseDelayMs = POLICY.structuredOutput.baseDelayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        response_format: responseFormat,
        temperature,
      })

      const raw = completion.choices?.[0]?.message?.content
      const parsedRaw = parseRaw(raw)
      const result = schema.parse(parsedRaw)

      logger.info(
        { schemaName, attempt, tokens: completion.usage?.total_tokens },
        'structured call succeeded',
      )
      return result
    } catch (e) {
      lastError = e
      logger.warn(
        {
          schemaName,
          attempt,
          error: e instanceof Error ? e.message : String(e),
        },
        'structured call failed, will retry',
      )
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * 2 ** (attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  logger.error(
    { schemaName, attempts: maxAttempts, lastError },
    'structured call exhausted retries, returning fallback',
  )
  return fallback
}
