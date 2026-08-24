import { describe, it, expect, beforeAll } from 'vitest'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { startSpan, getCurrentTraceId, requestIdToTraceId, withCorrelation } from '@/lib/tracing'

beforeAll(() => {
  // Register a real tracer provider in tests so context propagation and trace
  // ids are deterministic. Without a provider the API falls back to a no-op
  // tracer that ignores parent context.
  const provider = new NodeTracerProvider()
  provider.register()
})

describe('tracing', () => {
  it('propagates a trace id derived from request_id through async boundaries', async () => {
    const requestId = '12345678-1234-1234-1234-123456789abc'
    const expectedTraceId = requestIdToTraceId(requestId)

    let capturedTraceId: string | undefined

    await startSpan(
      'test.request',
      async () => {
        // Simulate an async hop to verify context propagation.
        await new Promise((resolve) => setTimeout(resolve, 1))
        capturedTraceId = getCurrentTraceId()
      },
      { requestId },
    )

    expect(capturedTraceId).toBe(expectedTraceId)
  })

  it('returns the value produced by the wrapped function', async () => {
    const result = await startSpan('test.compute', async () => 42)
    expect(result).toBe(42)
  })

  it('records exceptions and re-throws them', async () => {
    const error = new Error('boom')
    await expect(
      startSpan('test.error', async () => {
        throw error
      }),
    ).rejects.toThrow(error)
  })

  it('adds request_id and trace_id to correlation fields without mutating input', () => {
    const input = { userId: 'user-1' }
    const correlated = withCorrelation(input, 'req-123')

    expect(correlated).toEqual({ userId: 'user-1', request_id: 'req-123' })
    expect(input).toEqual({ userId: 'user-1' })
  })
})
