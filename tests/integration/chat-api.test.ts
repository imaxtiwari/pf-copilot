// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRunOrchestrator = vi.hoisted(() => vi.fn())
const mockRateLimit = vi.hoisted(() => vi.fn())
const mockDbInsert = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/dev-user', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/orchestrator', () => ({
  runOrchestrator: mockRunOrchestrator,
  CostBudgetExceededError: class CostBudgetExceededError extends Error {
    constructor(message: string, public cumulativeTokens: number, public maxTokens: number) {
      super(message)
      this.name = 'CostBudgetExceededError'
    }
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mockRateLimit,
  rateLimitJsonResponse: vi.fn((result) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ ok: false, error: { code: 'rate_limit_exceeded', details: result } }, { status: 429 })
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
  },
}))

vi.mock('@/db/schema', () => ({
  chatMessages: {},
}))

import { POST, GET } from '@/app/api/chat/route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockRunOrchestrator.mockReset()
    mockRateLimit.mockReset()
    mockDbInsert.mockReset()
    mockDbSelect.mockReset()

    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
    mockRateLimit.mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: Date.now() / 1000 + 60, retryAfter: 60 })
    mockRunOrchestrator.mockResolvedValue({
      assistant_message: 'Your portfolio is 60% equity.',
      tool_traces: [{ tool: 'get_portfolio', args: {}, result: { holdings: [] } }],
      citations: [],
      model_version: 'test-deployment',
      refusal_reason: null,
      request_id: 'req-1',
    })
    mockDbInsert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'msg-1' }]) }) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the user is not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const response = await POST(makeRequest({ message: 'hello' }))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error.code).toBe('unauthorized')
  })

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    mockRateLimit.mockResolvedValueOnce({ success: false, limit: 20, remaining: 0, reset: Date.now() / 1000 + 60, retryAfter: 60 })
    const response = await POST(makeRequest({ message: 'hello' }))
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error.code).toBe('rate_limit_exceeded')
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await POST(req)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('returns 422 for a missing message', async () => {
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns a successful envelope with workspace state', async () => {
    const response = await POST(makeRequest({ message: 'What is my portfolio?' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.assistant_message).toBe('Your portfolio is 60% equity.')
    expect(body.data.request_id).toBe('req-1')
    expect(body.data.workspace_state).toBeDefined()
  })

  it('returns 429 when the orchestrator exceeds the cost budget', async () => {
    const { CostBudgetExceededError } = await import('@/lib/orchestrator')
    mockRunOrchestrator.mockRejectedValue(new CostBudgetExceededError('budget exceeded', 5001, 5000))
    const response = await POST(makeRequest({ message: 'long question' }))
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error.code).toBe('cost_budget_exceeded')
    expect(body.error.details.max_tokens).toBe(5000)
  })

  it('returns 500 and persists an audit row on unexpected orchestrator errors', async () => {
    mockRunOrchestrator.mockRejectedValue(new Error('boom'))
    const response = await POST(makeRequest({ message: 'hello' }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('ORCHESTRATOR_ERROR')
    expect(mockDbInsert).toHaveBeenCalled()
  })
})

describe('GET /api/chat', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockDbSelect.mockReset()
  })

  it('returns 401 when the user is not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns recent messages in chronological order', async () => {
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () =>
              Promise.resolve([
                { id: 'm2', role: 'assistant', content: 'Answer', ts: new Date('2026-01-02'), citations: null, modelVersion: 'v1', refusalReason: null, requestId: 'r2' },
                { id: 'm1', role: 'user', content: 'Question', ts: new Date('2026-01-01'), citations: null, modelVersion: null, refusalReason: null, requestId: 'r1' },
              ]),
          }),
        }),
      }),
    })

    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.messages).toHaveLength(2)
    expect(body.data.messages[0].id).toBe('m1')
    expect(body.data.messages[1].id).toBe('m2')
  })
})