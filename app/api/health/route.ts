import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { ok, err } from '@/lib/contracts/error-envelope'
import { db } from '@/lib/db'
import { rateLimit, rateLimitJsonResponse } from '@/lib/rate-limit'

export type HealthCheckResult = {
  ok: true
  data: {
    status: 'healthy'
    checks: {
      db: boolean
      vector: boolean | null
    }
  }
}

export type HealthCheckError = {
  ok: false
  error: {
    code: string
    message: string
    details?: unknown
    request_id: string
  }
}

/**
 * GET /api/health
 *
 * Lightweight liveness/readiness probe. It pings the database and, if
 * QDRANT_URL is configured, attempts a cheap vector endpoint check.
 * It deliberately does NOT call any LLM, so it is safe for load balancers.
 */
export async function GET(req: NextRequest) {
  // Per-IP rate limit: 60 health checks per minute.
  const ipLimit = await rateLimit(req, { key: 'health:ip', limit: 60, window: 60 })
  if (!ipLimit.success) {
    return rateLimitJsonResponse(ipLimit)
  }

  const checks = {
    db: false,
    vector: null as boolean | null,
  }
  const errors: string[] = []

  try {
    await db.execute(sql`SELECT 1`)
    checks.db = true
  } catch (e) {
    errors.push(`db: ${e instanceof Error ? e.message : String(e)}`)
  }

  const qdrantUrl = process.env.QDRANT_URL
  if (qdrantUrl) {
    try {
      // Cheap, read-only endpoint to verify Qdrant connectivity.
      const res = await fetch(`${qdrantUrl}/collections`, { method: 'GET' })
      checks.vector = res.ok
      if (!res.ok) {
        errors.push(`vector: qdrant responded ${res.status}`)
      }
    } catch (e) {
      checks.vector = false
      errors.push(`vector: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (checks.db) {
    return NextResponse.json(ok({ status: 'healthy', checks }))
  }

  return NextResponse.json(
    err('health_check_failed', 'One or more health checks failed', { checks, errors }),
    { status: 503 },
  )
}
