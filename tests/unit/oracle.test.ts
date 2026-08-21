import { describe, it, expect, vi } from 'vitest'
import { oracleMiddleware } from '../../lib/oracle/oracle'
import { DeliberationMessage } from '../../lib/deliberation/message-schema'

// Mock Azure OpenAI to avoid calling the real API
vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4oMini: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '{"contradictions": []}' } }]
          })
        }
      }
    })),
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0))
  }
})

// Mock auditTrail to avoid database queries during oracleMiddleware test
vi.mock('../../lib/audit/audit-trail', () => {
  return {
    auditTrail: {
      log: vi.fn()
    },
    AuditActionType: {
      ORACLE_FLAG_RAISED: 'ORACLE_FLAG_RAISED',
      ORACLE_VALIDATION_PASSED: 'ORACLE_VALIDATION_PASSED'
    }
  }
})

describe('Oracle Middleware Unit Tests', () => {
  const baseMessage: Omit<DeliberationMessage, 'oracle_validation'> = {
    message_id: 'msg-1',
    pipeline_run_id: 'run-1',
    timestamp: new Date().toISOString(),
    sender: 'SOMA',
    message_type: 'FUND_REPORT',
    recipient: 'ALL',
    payload: {},
    references: []
  }

  it('should flag a message with numeric values but no source_url with SOURCE_MISSING', async () => {
    const msg: DeliberationMessage = {
      ...baseMessage,
      payload: {
        fact: 'Nifty returns are 15.5% in the last 123 days'
      }
    } as any

    const result = await oracleMiddleware(msg)
    expect(result.oracle_validation.status).toBe('FLAGGED')
    expect(result.oracle_validation.flags[0]).toContain('SOURCE_MISSING')
  })

  it('should pass a message mentioning Fund NAV with amfiindia.com source', async () => {
    const msg: DeliberationMessage = {
      ...baseMessage,
      payload: {
        details: 'The fund NAV is 42.15 currently.',
        source_url: 'https://amfiindia.com/nav-details'
      }
    } as any

    const result = await oracleMiddleware(msg)
    expect(result.oracle_validation.status).toBe('PASSED')
    expect(result.oracle_validation.flags).toHaveLength(0)
  })

  it('should flag a message mentioning Fund NAV without any approved source with HALLUCINATION_RISK', async () => {
    const msg: DeliberationMessage = {
      ...baseMessage,
      payload: {
        details: 'The fund NAV is 42.15 currently.',
        source_url: 'https://unapproved.com/nav-details'
      }
    } as any

    const result = await oracleMiddleware(msg)
    expect(result.oracle_validation.status).toBe('FLAGGED')
    expect(result.oracle_validation.flags[0]).toContain('HALLUCINATION_RISK')
  })

  it('should flag a message with Retrieved_at 10 days ago for SOMA_NAV_DATA with SOURCE_STALE', async () => {
    const tenDaysAgo = new Date()
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

    const msg: DeliberationMessage = {
      ...baseMessage,
      sender: 'SOMA',
      message_type: 'FUND_REPORT',
      payload: {
        retrieved_at: tenDaysAgo.toISOString(),
        source_url: 'https://amfiindia.com'
      }
    } as any

    const result = await oracleMiddleware(msg)
    expect(result.oracle_validation.status).toBe('FLAGGED')
    expect(result.oracle_validation.flags[0]).toContain('SOURCE_STALE')
  })

  it('should return PENDING status when ORACLE encounters an internal error and never throw', async () => {
    const circular: any = {}
    circular.self = circular

    const msg: DeliberationMessage = {
      ...baseMessage,
      payload: circular
    } as any

    const result = await oracleMiddleware(msg)
    expect(result.oracle_validation.status).toBe('PENDING')
    expect(result.oracle_validation.flags[0]).toContain('ORACLE_INTERNAL_ERROR')
  })
})
