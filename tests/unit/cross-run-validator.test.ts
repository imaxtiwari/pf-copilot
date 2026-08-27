import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateCrossRunConsistency, clearCrossRunCache } from '@/lib/oracle/cross-run-validator'
import { DeliberationMessage } from '@/lib/deliberation/message-schema'

const RUN_ID = 'a0eebc99-5c0b-4ef8-bb6d-6bb9bd380a11'
const PREV_RUN_ID = 'b0eebc99-5c0b-4ef8-bb6d-6bb9bd380a22'
const CLIENT_ID = 'c0eebc99-5c0b-4ef8-bb6d-6bb9bd380a33'

function makeDb(previousMessages: any[] = []) {
  let queryIndex = 0
  const runQuery = () => {
    queryIndex++
    if (queryIndex === 1) return [{ runId: RUN_ID, clientId: CLIENT_ID }]
    if (queryIndex === 2) return [{ runId: PREV_RUN_ID, clientId: CLIENT_ID }]
    return previousMessages
  }

  const chainable = (rows: any[]) => {
    const result: any = {
      limit: () => chainable(rows),
      orderBy: () => chainable(rows),
      then: (resolve: (value: any[]) => void) => resolve(rows),
    }
    return result
  }

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => chainable(runQuery())),
      })),
    })),
  } as any
}

function makeMessage(return_1yr: number, schemeCode = 'FUND001'): DeliberationMessage {
  return {
    message_id: 'm1',
    pipeline_run_id: RUN_ID,
    timestamp: new Date().toISOString(),
    sender: 'SOMA',
    message_type: 'FUND_REPORT',
    recipient: 'ALL',
    content: '',
    payload: { scheme_code: schemeCode, return_1yr: return_1yr },
    oracle_validation: { status: 'PENDING', flags: [] },
    references: [],
  }
}

describe('validateCrossRunConsistency', () => {
  beforeEach(() => {
    clearCrossRunCache()
  })

  it('returns ACCEPT when no previous messages exist', async () => {
    const db = makeDb([])
    const result = await validateCrossRunConsistency(db, 'SOMA', makeMessage(10), 5)

    expect(result.recommendation).toBe('ACCEPT')
    expect(result.anomalies).toHaveLength(0)
  })

  it('flags large return drift between runs', async () => {
    const db = makeDb([
      {
        pipelineRunId: PREV_RUN_ID,
        messageType: 'FUND_REPORT',
        sender: 'SOMA',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        payload: { scheme_code: 'FUND001', return_1yr: 10 },
      },
    ])
    const result = await validateCrossRunConsistency(db, 'SOMA', makeMessage(80), 5)

    expect(result.recommendation).toBe('REJECT')
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].field).toBe('fund_1yr_return')
  })

  it('does not leak holdings or personal data in anomalies', async () => {
    const db = makeDb([
      {
        pipelineRunId: PREV_RUN_ID,
        messageType: 'FUND_REPORT',
        sender: 'SOMA',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        payload: {
          scheme_code: 'FUND001',
          return_1yr: 10,
          raw_holdings: [{ schemeName: 'Secret Fund', value: 1000000 }],
          user_name: 'John Doe',
        },
      },
    ])
    const result = await validateCrossRunConsistency(db, 'SOMA', makeMessage(30), 5)

    const payloadJson = JSON.stringify(result)
    expect(payloadJson).not.toContain('Secret Fund')
    expect(payloadJson).not.toContain('John Doe')
    expect(payloadJson).not.toContain('raw_holdings')
  })
})
