import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { rateLimit, resetMemoryRateLimitStore, memoryRatelimit, nowSeconds } from '@/lib/rate-limit'

function makeRequest(init?: { cookie?: string; forwardedFor?: string }): NextRequest {
  const headers = new Headers()
  if (init?.forwardedFor) headers.set('x-forwarded-for', init.forwardedFor)
  const req = new NextRequest('http://localhost/api/test', { headers })
  if (init?.cookie) {
    req.cookies.set('pf_user_id', init.cookie)
  }
  return req
}

describe('rateLimit (memory backend)', () => {
  beforeEach(() => {
    resetMemoryRateLimitStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit', async () => {
    const req = makeRequest({ forwardedFor: '1.2.3.4' })
    for (let i = 0; i < 5; i++) {
      const result = await rateLimit(req, { key: 'test', limit: 5, window: 60 })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(5 - (i + 1))
    }
  })

  it('blocks requests that exceed the limit', async () => {
    const req = makeRequest({ forwardedFor: '1.2.3.4' })
    for (let i = 0; i < 5; i++) {
      await rateLimit(req, { key: 'test', limit: 5, window: 60 })
    }
    const result = await rateLimit(req, { key: 'test', limit: 5, window: 60 })
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('resets the window after it expires', async () => {
    const req = makeRequest({ forwardedFor: '1.2.3.4' })
    await rateLimit(req, { key: 'test', limit: 1, window: 60 })
    const blocked = await rateLimit(req, { key: 'test', limit: 1, window: 60 })
    expect(blocked.success).toBe(false)

    vi.advanceTimersByTime(61_000)

    const reset = await rateLimit(req, { key: 'test', limit: 1, window: 60 })
    expect(reset.success).toBe(true)
  })

  it('uses the user cookie as identifier before falling back to IP', async () => {
    const userReq = makeRequest({ cookie: 'user-123', forwardedFor: '1.2.3.4' })
    const ipReq = makeRequest({ forwardedFor: '1.2.3.4' })

    // Exhaust the per-user limit.
    await rateLimit(userReq, { key: 'test', limit: 2, window: 60, identifier: 'user:user-123' })
    await rateLimit(userReq, { key: 'test', limit: 2, window: 60, identifier: 'user:user-123' })
    const userBlocked = await rateLimit(userReq, { key: 'test', limit: 2, window: 60, identifier: 'user:user-123' })
    expect(userBlocked.success).toBe(false)

    // Same IP but no cookie should still be allowed because it resolves to a different identifier.
    const ipAllowed = await rateLimit(ipReq, { key: 'test', limit: 2, window: 60 })
    expect(ipAllowed.success).toBe(true)
  })

  it('returns a 429 envelope with Retry-After header', async () => {
    const { rateLimitJsonResponse } = await import('@/lib/rate-limit')
    const result = await memoryRatelimit('ratelimit:test:ip:abc', 1, 60)
    const blocked = await memoryRatelimit('ratelimit:test:ip:abc', 1, 60)
    const response = rateLimitJsonResponse(blocked)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe(String(blocked.retryAfter))
    const json = await response.json()
    expect(json.ok).toBe(false)
    expect(json.error.code).toBe('rate_limit_exceeded')
  })
})

describe('memoryRatelimit edge cases', () => {
  beforeEach(() => {
    resetMemoryRateLimitStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts a new bucket exactly when the old one expires', async () => {
    const start = nowSeconds()
    vi.setSystemTime(start * 1000)
    const first = await memoryRatelimit('edge:key', 1, 60)
    expect(first.success).toBe(true)
    expect(first.reset).toBe(start + 60)

    vi.setSystemTime((start + 60) * 1000)
    const second = await memoryRatelimit('edge:key', 1, 60)
    expect(second.success).toBe(true)
    expect(second.reset).toBe(start + 120)
  })
})
