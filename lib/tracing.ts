import {
  trace,
  context,
  SpanStatusCode,
  type Context,
  type Span,
  type SpanContext,
  type Tracer,
} from '@opentelemetry/api'

export const TRACER_NAME = 'pf-copilot'

/** Convert a UUID request_id to a 32-hex-character OpenTelemetry trace id. */
export function requestIdToTraceId(requestId: string): string {
  return requestId.replace(/-/g, '').toLowerCase()
}

/** Return the bound tracer for this service. */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}

/** Extract the trace id from the currently active OpenTelemetry context, if any. */
export function getCurrentTraceId(): string | undefined {
  const spanContext = trace.getSpanContext(context.active())
  return spanContext?.traceId
}

function makeRequestContext(requestId: string): Context {
  const traceId = requestIdToTraceId(requestId)
  const spanContext: SpanContext = {
    traceId,
    spanId: '0000000000000001',
    traceFlags: 1,
    isRemote: true,
  }
  return trace.setSpanContext(context.active(), spanContext)
}

export type SpanOptions = {
  attributes?: Record<string, string | number | boolean | undefined>
  /** Bind the span to a request_id-derived trace id. */
  requestId?: string
  kind?: number
}

/**
 * Run a function inside an OpenTelemetry span.
 * The span is ended automatically and errors are recorded.
 */
export async function startSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = getTracer()
  let ctx = context.active()
  if (options?.requestId) {
    ctx = makeRequestContext(options.requestId)
  }
  const cleanedAttributes = cleanAttributes(options?.attributes)

  return tracer.startActiveSpan(
    name,
    { attributes: cleanedAttributes, kind: options?.kind },
    ctx,
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        throw error
      } finally {
        span.end()
      }
    },
  )
}

function cleanAttributes(
  attrs: Record<string, string | number | boolean | undefined> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!attrs) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

/**
 * Add a request_id attribute to a log/merge object and ensure it matches the
 * active trace id when a span is present.  Returns a new object so callers can
 * keep their original references immutable.
 */
export function withCorrelation(
  obj: Record<string, unknown>,
  requestId?: string,
): Record<string, unknown> {
  const traceId = getCurrentTraceId()
  return {
    ...obj,
    ...(traceId && { trace_id: traceId }),
    ...(requestId && { request_id: requestId }),
  }
}
