// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())
const mockDbQuery = vi.hoisted(() => vi.fn())
const mockGetLatestInsight = vi.hoisted(() => vi.fn())
const mockGenerateInsight = vi.hoisted(() => vi.fn())
const mockPersistInsight = vi.hoisted(() => vi.fn())
const mockInngestSend = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/dev-user', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: mockDbSelect,
    query: { userProfile: { findFirst: mockDbQuery } },
  },
}))

vi.mock('@/db/schema', () => ({
  portfolioHoldings: {},
  portfolioSnapshots: {},
}))

vi.mock('@/lib/portfolio/insights', () => ({
  getLatestInsight: mockGetLatestInsight,
  generateInsight: mockGenerateInsight,
  persistInsight: mockPersistInsight,
}))

vi.mock('@/lib/jobs/client', () => ({
  inngest: { send: mockInngestSend },
}))

import { GET as getHoldings } from '@/app/api/portfolio/holdings/route'
import { GET as getInsights } from '@/app/api/portfolio/insights/route'
import { GET as getTimeline } from '@/app/api/portfolio/timeline/route'
import { GET as getScheduler, POST as postScheduler } from '@/app/api/scheduler/route'

describe('Portfolio API routes', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockDbSelect.mockReset()
    mockDbQuery.mockReset()
    mockGetLatestInsight.mockReset()
    mockGenerateInsight.mockReset()
    mockPersistInsight.mockReset()

    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET /api/portfolio/holdings returns holdings', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              { id: 'h1', schemeName: 'Nifty 50', folioNumber: 'F1', units: '10', nav: '100', marketValue: '1000', asOfDate: '2026-07-26', source: 'cas_text' },
            ]),
        }),
      }),
    })

    const response = await getHoldings()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.holdings).toHaveLength(1)
  })

  it('GET /api/portfolio/insights returns cached insight', async () => {
    mockGetLatestInsight.mockResolvedValue({ id: 'i1', title: 'Insight', body: 'Body', createdAt: new Date().toISOString() })
    const response = await getInsights()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.insight.title).toBe('Insight')
    expect(mockGenerateInsight).not.toHaveBeenCalled()
  })

  it('GET /api/portfolio/insights backfills when no insight exists', async () => {
    mockGetLatestInsight.mockResolvedValue(null)
    mockGenerateInsight.mockResolvedValue({ userId: 'user-1', title: 'Generated', body: 'Body' })
    mockPersistInsight.mockResolvedValue({ id: 'i2', title: 'Generated', body: 'Body', createdAt: new Date().toISOString() })

    const response = await getInsights()
    expect(response.status).toBe(200)
    expect(mockGenerateInsight).toHaveBeenCalled()
    expect(mockPersistInsight).toHaveBeenCalled()
  })

  it('GET /api/portfolio/timeline returns snapshots and xirr', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              { id: 's1', asOfDate: '2024-07-26', totalValue: '100000', realReturnAnnualized: '0.05', inflationRateUsed: '0.06' },
              { id: 's2', asOfDate: '2025-07-26', totalValue: '110000', realReturnAnnualized: '0.06', inflationRateUsed: '0.06' },
            ]),
        }),
      }),
    })

    const response = await getTimeline()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.snapshots).toHaveLength(2)
    expect(body.data.xirr).toBeDefined()
  })
})

describe('Scheduler API route', () => {
  beforeEach(() => {
    mockInngestSend.mockReset()
  })

  it('GET /api/scheduler lists ingestion jobs', async () => {
    const response = await getScheduler()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.jobs).toContain('ingest.amfi')
  })

  it('POST /api/scheduler enqueues jobs', async () => {
    mockInngestSend.mockResolvedValue({ ids: ['event-1', 'event-2', 'event-3'] })
    const response = await postScheduler()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.enqueued).toBe(3)
  })

  it('POST /api/scheduler returns 500 on queue error', async () => {
    mockInngestSend.mockRejectedValue(new Error('queue down'))
    const response = await postScheduler()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('QUEUE_ERROR')
  })
})