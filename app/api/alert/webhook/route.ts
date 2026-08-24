import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/contracts/error-envelope'
import logger from '@/lib/logger'

/**
 * Alerting webhook placeholder for PagerDuty/Opsgenie integration.
 *
 * In production this route can be pointed at by:
 * - Vercel Log Drains
 * - Datadog/CloudWatch monitors
 * - Internal health checks
 *
 * It expects a shared secret in the `x-alert-secret` header so that
 * unauthenticated callers cannot trigger incident workflows.
 */

const AlertPayloadSchema = z.object({
  source: z.string().optional(),
  severity: z.enum(['critical', 'warning', 'info']).default('warning'),
  message: z.string(),
  request_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-alert-secret')
  const expected = process.env.ALERT_WEBHOOK_SECRET

  if (expected && secret !== expected) {
    return NextResponse.json(err('UNAUTHORIZED', 'Invalid or missing alert secret'), { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(err('INVALID_JSON', 'Request body must be valid JSON'), { status: 400 })
  }

  const parsed = AlertPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      err('VALIDATION_ERROR', 'Invalid alert payload', parsed.error.flatten()),
      { status: 422 },
    )
  }

  const { source, severity, message, request_id } = parsed.data

  logger.error(
    { alertSource: source ?? 'unknown', severity, message, request_id },
    'alert webhook received',
  )

  // TODO: integrate with PagerDuty Events API v2 or Opsgenie alert API.
  // This placeholder acknowledges the alert so monitors can be wired end-to-end.
  return NextResponse.json(
    ok({
      acknowledged: true,
      source: source ?? 'unknown',
      severity,
      message,
      request_id: request_id ?? null,
    }),
  )
}
