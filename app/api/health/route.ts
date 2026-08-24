import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { ok, err } from '@/lib/contracts/error-envelope'
import { db } from '@/lib/db'
import { rateLimit, rateLimitJsonResponse } from '@/lib/rate-limit'
import { validateQdrantDimension } from '@/lib/qdrant/dimension-check'

export type HealthCheckResult = {
  ok: true
  data: {
    status: 'healthy'
    checks: {
      db: boolean
      vector: boolean | null
      vector_dimension: boolean | null
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
 * QDRANT_URL is configured, attempts a cheap vector endpoint check and, if
 * QDRANT_COLLECTIONS is configured, verifies embedding dimensions.
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
    vector_dimension: null as boolean | null,
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

    // Verify configured collection vector dimensions.
    const expectedDimension = Number.parseInt(process.env.EMBEDDING_DIMENSION ?? '1536', 10)
    const collections = process.env.QDRANT_COLLECTIONS?.split(',').map((c) => c.trim()).filter(Boolean) ?? []
    const dimCheck = await validateQdrantDimension(qdrantUrl, expectedDimension, collections)
    checks.vector_dimension = dimCheck.ok
    if (!dimCheck.ok) {
      errors.push(
        `vector_dimension: ${dimCheck.mismatches.map((m) => `${m.collection} expected ${m.expected} got ${m.actual}`).join('; ')}`,
      )
    }
  }

  if (checks.db && checks.vector_dimension !== false) {
    return NextResponse.json(ok({ status: 'healthy', checks }))
  }

  return NextResponse.json(
    err('health_check_failed', 'One or more health checks failed', { checks, errors }),
    { status: 503 },
  )
}
