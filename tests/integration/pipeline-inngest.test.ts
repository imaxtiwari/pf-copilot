// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRateLimit = vi.hoisted(() => vi.fn())
const mockParseCAS = vi.hoisted(() => vi.fn())
const mockRefreshSnapshots = vi.hoisted(() => vi.fn())
const mockGenerateInsight = vi.hoisted(() => vi.fn())
const mockPersistInsight = vi.hoisted(() => vi.fn())
const mockDbTransaction = vi.hoisted(() => vi.fn())
const mockDbInsert = vi.hoisted(() => vi.fn())
const mockDbQuery = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())
const mockDbUpdate = vi.hoisted(() => vi.fn())
const mockInngestSend = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/dev-user', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mockRateLimit,
  rateLimitJsonResponse: vi.fn((result) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ ok: false, error: { code: 'rate_limit_exceeded', details: result } }, { status: 429 })
  }),
}))

vi.mock('@/lib/cas/parse', () => ({
  parseCAS: mockParseCAS,
}))

vi.mock('@/lib/portfolio/snapshots', () => ({
  refreshSnapshots: mockRefreshSnapshots,
}))

vi.mock('@/lib/portfolio/insights', () => ({
  generateInsight: mockGenerateInsight,
  persistInsight: mockPersistInsight,
}))

vi.mock('@/lib/db', () => ({
  db: {
    transaction: mockDbTransaction,
    insert: () => mockDbInsert(),
    query: {
      portfolioHoldings: { findMany: mockDbQuery },
      pipelineRuns: { findFirst: mockDbQuery },
      casUploads: { findFirst: mockDbQuery },
    },
    select: mockDbSelect,
    update: () => mockDbUpdate(),
  },
}))

vi.mock('@/db/schema', () => ({
  casUploads: {},
  portfolioHoldings: {},
  pipelineRuns: {},
}))

vi.mock('@/lib/jobs/client', () => ({
  inngest: { send: mockInngestSend, createFunction: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  default: { error: mockLoggerError, info: mockLoggerInfo, warn: mockLoggerWarn },
}))

import { POST as postCasIngest } from '@/app/api/cas/ingest/route'
import { handlePipelineStart } from '@/lib/jobs/handlers/pipeline/start'

function makeCasRequest(file: File): NextRequest {
  const formData = new FormData()
  formData.append('file', file)
  return new NextRequest('http://localhost/api/cas/ingest', {
    method: 'POST',
    body: formData,
  })
}

function setupValidCasUpload() {
  mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
  mockRateLimit.mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: Date.now() / 1000 + 3600, retryAfter: 3600 })
  mockParseCAS.mockResolvedValue({
    ok: true,
    extraction: {
      holdings: [{ scheme_name: 'Nifty 50 Index Fund', scheme_code: '120503', folio_number: '123', units: 100, nav: 2500, market_value: 250000 }],
      total_value_reported: 250000,
      as_of_date: '2026-07-26',
    },
    source: 'text',
    schemeCheck: { unmatched: [] },
    hash: 'hash-1',
  })
  mockDbTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 'upload-1' }]),
        }),
      }),
    }
    return callback(tx)
  })
  mockDbInsert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'failure-upload-1' }]) }) })
  mockRefreshSnapshots.mockResolvedValue(undefined)
  mockGenerateInsight.mockResolvedValue({ userId: 'user-1', uploadId: 'upload-1', title: 'Mock', body: 'Mock body' })
  mockPersistInsight.mockResolvedValue(undefined)
  mockInngestSend.mockResolvedValue({ ids: ['event-1'] })
}


describe('POST /api/cas/ingest pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupValidCasUpload()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends pipeline.start after holdings persist', async () => {
    const file = new File([new ArrayBuffer(1024)], 'cas.pdf', { type: 'application/pdf' })
    const response = await postCasIngest(makeCasRequest(file))
    expect(response.status).toBe(200)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'pipeline.start',
      data: { userId: 'user-1', uploadId: 'upload-1' },
    })
  })

  it('rate-limits pipeline.start to one per user per 10 minutes', async () => {
    // First upload succeeds and enqueues pipeline.
    const file = new File([new ArrayBuffer(1024)], 'cas.pdf', { type: 'application/pdf' })
    let response = await postCasIngest(makeCasRequest(file))
    expect(response.status).toBe(200)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)

    // Second upload within window hits the pipeline rate limit.
    mockRateLimit.mockImplementation(async (_req: NextRequest, options: { key: string }) => {
      if (options.key === 'pipeline:start') {
        return { success: false, limit: 1, remaining: 0, reset: Date.now() / 1000 + 600, retryAfter: 600 }
      }
      return { success: true, limit: 5, remaining: 4, reset: Date.now() / 1000 + 3600, retryAfter: 3600 }
    })

    response = await postCasIngest(makeCasRequest(file))
    expect(response.status).toBe(200)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfter: 600 }),
      'cas ingest: pipeline.start rate limited',
    )
  })
})

describe('pipeline.start handler', () => {
  const userId = '00000000-0000-0000-0000-000000000001'
  const uploadId = '00000000-0000-0000-0000-000000000002'

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbInsert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ runId: 'run-1' }]) }) })
    mockDbUpdate.mockReturnValue({ set: () => ({ where: () => Promise.resolve([]) }) })
    mockDbQuery.mockResolvedValue([])
    mockGenerateInsight.mockResolvedValue({ userId, uploadId, title: 'Mock', body: 'Mock body' })
    mockPersistInsight.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a run, steps through stages, and returns COMPLETED', async () => {
    const step = { run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as <T>(name: string, fn: () => Promise<T>) => Promise<T> }
    const event = { data: { userId, uploadId } }

    const result = await handlePipelineStart(event, step)

    expect(result).toEqual({ runId: 'run-1', status: 'COMPLETED' })
    expect(step.run).toHaveBeenCalledTimes(4)
    expect(mockDbInsert).toHaveBeenCalled()
    expect(mockGenerateInsight).toHaveBeenCalledWith({ userId, uploadId })
  })

  it('marks the run FAILED when a stage errors', async () => {
    mockGenerateInsight.mockRejectedValue(new Error('insight failed'))
    const step = { run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as <T>(name: string, fn: () => Promise<T>) => Promise<T> }
    const event = { data: { userId, uploadId } }

    await expect(handlePipelineStart(event, step)).rejects.toThrow('insight failed')

    expect(step.run).toHaveBeenCalledWith('mark-failed', expect.any(Function))
    expect(mockDbUpdate).toHaveBeenCalled()
  })
})
