import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { structuredCall, StructuredCallError } from '@/lib/llm/structured-call'

const TestSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
})

type TestOutput = z.infer<typeof TestSchema>

function makeClient(
  responses: Array<string | { answer: string; confidence: number }>,
) {
  let callCount = 0
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const payload = responses[callCount++]
          const content = typeof payload === 'string' ? payload : JSON.stringify(payload)
          return {
            choices: [{ message: { content } }],
            usage: { total_tokens: 10 },
          }
        }),
      },
    },
  }
}

describe('structuredCall', () => {
  it('returns parsed result on a valid response', async () => {
    const client = makeClient([{ answer: 'yes', confidence: 0.9 }])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      fallback,
    })

    expect(result).toEqual({ answer: 'yes', confidence: 0.9 })
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('retries on malformed JSON and succeeds on second attempt', async () => {
    const client = makeClient(['not json', '{"answer":"yes","confidence":0.9}'])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      fallback,
    })

    expect(result).toEqual({ answer: 'yes', confidence: 0.9 })
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('retries on schema violations and succeeds on third attempt', async () => {
    const client = makeClient([
      '{"answer":"yes","confidence":2}',
      '{"answer":"yes"}',
      '{"answer":"yes","confidence":0.9}',
    ])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      fallback,
    })

    expect(result).toEqual({ answer: 'yes', confidence: 0.9 })
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('returns fallback after exhausting retries', async () => {
    const client = makeClient(['bad', 'worse', 'worst'])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      fallback,
    })

    expect(result).toEqual(fallback)
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('strips markdown fences before parsing', async () => {
    const client = makeClient(['```json\n{"answer":"yes","confidence":0.9}\n```'])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      fallback,
    })

    expect(result).toEqual({ answer: 'yes', confidence: 0.9 })
  })

  it('respects a custom maxAttempts', async () => {
    const client = makeClient(['bad'])
    const fallback: TestOutput = { answer: 'fallback', confidence: 0 }

    const result = await structuredCall({
      client: client as any,
      model: 'gpt-4o-mini',
      messages: [],
      schema: TestSchema,
      schemaName: 'test',
      maxAttempts: 1,
      fallback,
    })

    expect(result).toEqual(fallback)
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1)
  })
})
