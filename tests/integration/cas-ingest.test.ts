// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockRateLimit = vi.hoisted(() => vi.fn())
const mockParseCAS = vi.hoisted(() => vi.fn())
const mockRefreshSnapshots = vi.hoisted(() => vi.fn())
const mockGenerateInsight = vi.hoisted(() => vi.fn())
const mockPersistInsight = vi.hoisted(() => vi.fn())
const mockDbTransaction = vi.hoisted(() => vi.fn())
const mockDbInsert = vi.hoisted(() => vi.fn())
const mockDbQuery = vi.hoisted(() => vi.fn())
const mockInngestSend = vi.hoisted(() => vi.fn())

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
    query: { portfolioHoldings: { findMany: mockDbQuery } },
  },
}))

vi.mock('@/db/schema', () => ({
  casUploads: {},
  portfolioHoldings: {},
}))

vi.mock('@/lib/jobs/client', () => ({
  inngest: { send: mockInngestSend },
}))

import { POST } from '@/app/api/cas/ingest/route'

function makeRequest(file: File): NextRequest {
  const formData = new FormData()
  formData.append('file', file)
  return new NextRequest('http://localhost/api/cas/ingest', {
    method: 'POST',
    body: formData,
  })
}

const FIXTURE_PATH = path.join(__dirname, '../fixtures/cas-sample.pdf')

describe('POST /api/cas/ingest', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockRateLimit.mockReset()
    mockParseCAS.mockReset()
    mockRefreshSnapshots.mockReset()
    mockGenerateInsight.mockReset()
    mockPersistInsight.mockReset()
    mockDbTransaction.mockReset()
    mockDbInsert.mockReset()
    mockDbQuery.mockReset()
    mockInngestSend.mockReset()

    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
    mockRateLimit.mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: Date.now() / 1000 + 3600, retryAfter: 3600 })
    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: 'upload-1' }]),
          }),
        }),
      }
      return callback(tx)
    })
    mockRefreshSnapshots.mockResolvedValue(undefined)
    mockGenerateInsight.mockResolvedValue({ userId: 'user-1', uploadId: 'upload-1', title: 'Mock', body: 'Mock body' })
    mockPersistInsight.mockResolvedValue(undefined)
    mockDbInsert.mockReturnValue({ values: () => ({ returning: () => Promise.resolve([{ id: 'failure-upload-1' }]) }) })
    mockInngestSend.mockResolvedValue({ ids: ['event-1'] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the user is not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const file = new File(['pdf'], 'cas.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(401)
  })

  it('returns 429 when the upload rate limit is exceeded', async () => {
    mockRateLimit.mockResolvedValueOnce({ success: false, limit: 5, remaining: 0, reset: Date.now() / 1000 + 3600, retryAfter: 3600 })
    const file = new File(['pdf'], 'cas.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(429)
  })

  it('returns 400 for non-multipart requests', async () => {
    const req = new NextRequest('http://localhost/api/cas/ingest', { method: 'POST' })
    const response = await POST(req)
    expect(response.status).toBe(400)
  })

  it('returns 400 when the file field is missing', async () => {
    const formData = new FormData()
    formData.append('file', 'not-a-file')
    const req = new NextRequest('http://localhost/api/cas/ingest', { method: 'POST', body: formData })
    const response = await POST(req)
    expect(response.status).toBe(400)
  })

  it('returns 400 for non-PDF files', async () => {
    const file = new File(['text'], 'cas.txt', { type: 'text/plain' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(400)
  })

  it('returns 413 for oversized PDFs', async () => {
    const file = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(413)
  })

  it('returns cached holdings without persisting a new upload', async () => {
    mockParseCAS.mockResolvedValue({ ok: true, fromCache: true, uploadId: 'upload-1', hash: 'hash-1' })
    mockDbQuery.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }])

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const file = new File([buffer], 'cas-sample.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.holdings_count).toBe(2)
    expect(body.data.from_cache).toBe(true)
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })

  it('returns 422 when CAS validation fails', async () => {
    mockParseCAS.mockResolvedValue({ ok: false, errors: ['Missing holdings'], source: 'text', hash: 'hash-1' })

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const file = new File([buffer], 'cas-sample.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe('cas_validation_failed')
  })

  it('persists holdings and refreshes snapshots on a valid extraction', async () => {
    mockParseCAS.mockResolvedValue({
      ok: true,
      extraction: {
        holdings: [
          { scheme_name: 'Nifty 50 Index Fund', scheme_code: '120503', folio_number: '123', units: 100, nav: 2500, market_value: 250000 },
        ],
        total_value_reported: 250000,
        as_of_date: '2026-07-26',
      },
      source: 'text',
      schemeCheck: { unmatched: [] },
      hash: 'hash-1',
    })

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const file = new File([buffer], 'cas-sample.pdf', { type: 'application/pdf' })
    const response = await POST(makeRequest(file))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.holdings_count).toBe(1)
    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockRefreshSnapshots).toHaveBeenCalledWith('user-1')
    expect(mockPersistInsight).toHaveBeenCalled()
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'pipeline.start',
      data: { userId: 'user-1', uploadId: 'upload-1' },
    })
  })
})