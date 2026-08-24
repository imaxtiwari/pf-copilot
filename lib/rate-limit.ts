import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { err } from '@/lib/contracts/error-envelope'
import logger from '@/lib/logger'

// ── types ─────────────────────────────────────────────────────────────────────

export type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number // epoch seconds
  retryAfter: number // seconds
}

export type RateLimitOptions = {
  /** Human-readable namespace used as a key prefix. */
  key: string
  /** Maximum number of requests allowed in the window. */
  limit: number
  /** Window duration in seconds. */
  window: number
  /**
   * Unique identifier for the caller.
   * If omitted, falls back to an authenticated user ID from the request cookie,
   * then to a hashed IP address.
   */
  identifier?: string
}

// ── backends ──────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production'

function hasUpstashConfig(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

const upstashInstances = new Map<string, Ratelimit>()
let memoryStore: Map<string, { count: number; resetAt: number }> | null = null

function getUpstashRatelimit(limit: number, windowSeconds: number): Ratelimit {
  const cacheKey = `${limit}:${windowSeconds}`
  let instance = upstashInstances.get(cacheKey)
  if (!instance) {
    const redis = Redis.fromEnv()
    instance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      analytics: true,
    })
    upstashInstances.set(cacheKey, instance)
  }
  return instance
}

function getMemoryStore(): Map<string, { count: number; resetAt: number }> {
  if (!memoryStore) {
    memoryStore = new Map()
  }
  return memoryStore
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export async function memoryRatelimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const store = getMemoryStore()
  const now = nowSeconds()
  const bucket = store.get(key)

  let count: number
  let resetAt: number

  if (!bucket || bucket.resetAt <= now) {
    count = 1
    resetAt = now + windowSeconds
    store.set(key, { count, resetAt })
  } else {
    count = bucket.count + 1
    resetAt = bucket.resetAt
    store.set(key, { count, resetAt })
  }

  const remaining = Math.max(0, limit - count)
  const success = count <= limit
  const retryAfter = Math.max(0, resetAt - now)

  return { success, limit, remaining, reset: resetAt, retryAfter }
}

/**
 * Reset the in-memory rate-limit store. Intended only for deterministic tests.
 * Has no effect when the Upstash backend is active.
 */
export function resetMemoryRateLimitStore(): void {
  memoryStore?.clear()
}

// ── identifier resolution ─────────────────────────────────────────────────────

const COOKIE_NAME = 'pf_user_id'

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  // NextRequest does not expose `ip` on Node runtime, but some edge runtimes do.
  return ((req as { ip?: string }).ip) ?? 'unknown'
}

function resolveIdentifier(req: NextRequest, provided?: string): string {
  if (provided) return provided

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value
  if (cookieValue) return `user:${cookieValue}`

  return `ip:${hashIp(getClientIp(req))}`
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Perform a rate-limit check for the given request.
 *
 * In production the function requires Upstash Redis (UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN). In local/test environments a memory-backed fallback
 * is used, but it is intentionally ephemeral and unsuitable for production
 * because limits do not share state across serverless invocations.
 */
export async function rateLimit(req: NextRequest, options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, window: windowSeconds, identifier } = options
  const resolvedId = resolveIdentifier(req, identifier)
  const fullKey = `ratelimit:${key}:${resolvedId}`

  if (hasUpstashConfig()) {
    const ratelimit = getUpstashRatelimit(limit, windowSeconds)
    const result = await ratelimit.limit(fullKey)
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: Math.floor(result.reset / 1000),
      retryAfter: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
    }
  }

  if (isProduction) {
    // Fail closed: do not allow unlimited requests in production.
    logger.error(
      { namespace: key },
      'Rate limiting is disabled in production because Upstash Redis is not configured.',
    )
    return { success: false, limit: 0, remaining: 0, reset: nowSeconds(), retryAfter: Infinity }
  }

  logger.warn(
    { namespace: key, identifier: resolvedId.split(':')[0] },
    'Using in-memory rate limiter. This is for local development only.',
  )
  return memoryRatelimit(fullKey, limit, windowSeconds)
}

/**
 * Build a standardized 429 Too Many Requests JSON response using the application
 * error envelope. Includes a `Retry-After` header when available.
 */
export function rateLimitJsonResponse(result: RateLimitResult): NextResponse {
  const requestId = randomUUID()
  const windowSeconds = Math.max(0, result.reset - nowSeconds())
  const response = NextResponse.json(
    err(
      'rate_limit_exceeded',
      `Rate limit exceeded. Try again in ${result.retryAfter} second${result.retryAfter === 1 ? '' : 's'}.`,
      { limit: result.limit, window_seconds: windowSeconds + result.retryAfter },
      requestId,
    ),
    { status: 429 },
  )
  if (Number.isFinite(result.retryAfter)) {
    response.headers.set('Retry-After', String(result.retryAfter))
  }
  return response
}

/**
 * Build a 429 response formatted as an SSE error line.
 */
export function rateLimitSseResponse(result: RateLimitResult): Response {
  const requestId = randomUUID()
  const windowSeconds = Math.max(0, result.reset - nowSeconds())
  const data = {
    ok: false,
    error: {
      code: 'rate_limit_exceeded',
      message: `Rate limit exceeded. Try again in ${result.retryAfter} second${result.retryAfter === 1 ? '' : 's'}.`,
      details: { limit: result.limit, window_seconds: windowSeconds + result.retryAfter },
      request_id: requestId,
    },
  }
  const body = `event: error\ndata: ${JSON.stringify(data)}\n\n`
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  }
  if (Number.isFinite(result.retryAfter)) {
    headers['Retry-After'] = String(result.retryAfter)
  }
  return new Response(body, { status: 429, headers })
}
