import { describe, it, expect, vi, beforeEach } from 'vitest'
import { oracleMiddleware } from '@/lib/oracle/oracle'
import { getGpt4oMini } from '@/lib/azure-openai'
import { DeliberationMessage } from '@/lib/deliberation/message-schema'

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {},
}))

vi.mock('@/lib/azure-openai', () => ({
  getGpt4oMini: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}))

function makeMessage(overrides: Partial<DeliberationMessage> = {}): DeliberationMessage {
  return {
    message_id: 'm1',
    pipeline_run_id: 'r1',
    timestamp: new Date().toISOString(),
    sender: 'SOMA',
    message_type: 'FUND_REPORT',
    recipient: 'ALL',
    content: '',
    payload: {
      scheme_code: 'FUND001',
      scheme_name: 'Test Fund',
      nav: 42.5,
      source_url: 'https://amfiindia.com',
    },
    oracle_validation: { status: 'PENDING', flags: [] },
    references: [],
    ...overrides,
  } as DeliberationMessage
}

describe('ORACLE middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes a message with valid source URL', async () => {
    const db = { select: vi.fn() }
    const msg = makeMessage()
    const result = await oracleMiddleware(db, msg)

    expect(result.oracle_validation.status).toBe('PASSED')
    expect(result.oracle_validation.flags).toHaveLength(0)
  })

  it('flags factual claims without sources', async () => {
    const db = { select: vi.fn() }
    const msg = makeMessage({
      payload: { scheme_code: 'FUND001', nav: 142.5 },
      references: [],
    })
    const result = await oracleMiddleware(db, msg)

    expect(result.oracle_validation.status).toBe('FLAGGED')
    expect(result.oracle_validation.flags?.some((f) => f.includes('SOURCE_MISSING'))).toBe(true)
  })

  it('does not flag disclaimer-related messages', async () => {
    const db = { select: vi.fn() }
    const msg = makeMessage({
      content: 'This is not investment advice. Educational disclaimer.',
      payload: { nav: 42.5 },
      references: [],
    })
    const result = await oracleMiddleware(db, msg)

    expect(result.oracle_validation.status).toBe('PASSED')
  })

  it('never blocks messages permanently (always returns a message)', async () => {
    const db = { select: vi.fn() }
    const msg = makeMessage({
      payload: { scheme_code: 'FUND001', nav: 42.5 },
      references: [],
    })
    const result = await oracleMiddleware(db, msg)

    expect(result).toBeDefined()
    expect(result.message_id).toBe(msg.message_id)
    expect(['PASSED', 'FLAGGED', 'PENDING']).toContain(result.oracle_validation.status)
  })

  it('flags hallucination-risk claims missing required source', async () => {
    vi.mocked(getGpt4oMini).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: JSON.stringify({ contradictions: [] }) } }],
          })),
        },
      },
    } as any)

    const db = { select: vi.fn() }
    const msg = makeMessage({
      content: '',
      payload: {
        scheme_code: 'FUND001',
        scheme_name: 'Test Fund',
        description: 'expense ratio 1.05%',
      },
      references: [],
    })
    const result = await oracleMiddleware(db, msg)

    expect(result.oracle_validation.status).toBe('FLAGGED')
    expect(result.oracle_validation.flags?.some((f) => f.includes('HALLUCINATION_RISK'))).toBe(true)
  })
})
