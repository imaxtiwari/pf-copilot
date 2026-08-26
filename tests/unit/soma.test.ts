import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Soma } from '@/lib/agents/soma'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { db } from '@/lib/db'

vi.mock('@/lib/memory/memory-store', () => ({
  writeMemory: vi.fn(async () => ({ _key: 'mock-key' })),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

const publishMock = vi.fn(async (msg: any) => ({ message_id: 'msg-1', ...msg }))

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  }
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  return chain
}

function makeMockDb() {
  return {
    select: vi.fn(() => makeSelectChain([])),
    execute: vi.fn(async () => ({ rows: [] })),
  }
}

const RUN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Soma', () => {
  const room = new DeliberationRoom()
  room.bind = vi.fn(() => ({ publish: publishMock })) as any
  const webTool = new WebResearchTool('SOMA', room)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(db, makeMockDb())
  })

  it('builds a fresh fund profile when a recent snapshot exists', async () => {
    const today = new Date().toISOString().split('T')[0]

    const mockDb = makeMockDb()
    let callCount = 0
    mockDb.select = vi.fn(() => {
      callCount++
      if (callCount === 1) {
        return makeSelectChain([{ schemeCode: 'FUND001', schemeName: 'Test Fund', schemeType: 'equity', amcName: 'Test AMC' }])
      }
      return makeSelectChain([{ schemeCode: 'FUND001', snapshotDate: today, nav: '123.45', createdAt: new Date() }])
    })
    Object.assign(db, mockDb)

    const soma = new Soma(room, webTool, mockDb as any)
    const profile = await soma.getFundProfile('FUND001', RUN_ID, 'client-1')

    expect(profile.scheme_code).toBe('FUND001')
    expect(profile.data_freshness.is_stale).toBe(false)
    expect(profile.nav).toBe(123.45)
  })

  it('marks a profile stale when the latest snapshot is older than 7 days', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const mockDb = makeMockDb()
    let callCount = 0
    mockDb.select = vi.fn(() => {
      callCount++
      if (callCount === 1) {
        return makeSelectChain([{ schemeCode: 'FUND002', schemeName: 'Test Fund', schemeType: 'equity', amcName: 'Test AMC' }])
      }
      return makeSelectChain([{ schemeCode: 'FUND002', snapshotDate: oldDate, nav: '100', createdAt: new Date() }])
    })
    Object.assign(db, mockDb)

    const soma = new Soma(room, webTool, mockDb as any)
    const profile = await soma.getFundProfile('FUND002', RUN_ID, 'client-1')

    expect(profile.data_freshness.is_stale).toBe(true)
    expect(profile.data_freshness.days_old).toBeGreaterThan(7)
  })

  it('throws when the fund is not in agent_funds', async () => {
    const mockDb = makeMockDb()
    mockDb.select = vi.fn(() => makeSelectChain([]))
    Object.assign(db, mockDb)

    const soma = new Soma(room, webTool, mockDb as any)
    await expect(soma.getFundProfile('UNKNOWN', RUN_ID)).rejects.toThrow('not found')
  })

  it('curates an eligible fund universe using current schema fields', async () => {
    const mockDb = makeMockDb()
    let callCount = 0
    mockDb.select = vi.fn(() => {
      callCount++
      return makeSelectChain([{ schemeCode: 'FUND001' }, { schemeCode: 'FUND002' }])
    })
    mockDb.execute = vi.fn(async () => ({
      rows: [
        {
          scheme_code: 'FUND001',
          scheme_name: 'Test Large Cap',
          scheme_type: 'equity',
          aum_cr: '1200',
          expense_ratio: '1.2',
          nav: '150',
          track_record_months: 60,
        },
      ],
    })) as any
    Object.assign(db, mockDb)

    const soma = new Soma(room, webTool, mockDb as any)
    const universe = await soma.getEligibleFundUniverse(RUN_ID, 'client-1')

    expect(universe.total_eligible).toBe(1)
    expect(universe.eligible_funds[0].scheme_code).toBe('FUND001')
    expect(universe.filters_applied.some((f) => f.filter === 'min_aum_equity_cr')).toBe(true)
    expect(publishMock).toHaveBeenCalled()
  })
})
