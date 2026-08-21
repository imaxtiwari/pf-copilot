import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateCrossRunConsistency } from '../../lib/oracle/cross-run-validator'
import { DeliberationMessage } from '../../lib/deliberation/message-schema'
import * as schema from '../../db/schema'

let mockPipelineRuns: any[] = []
let mockDeliberationMessages: any[] = []
let lastTableQueried: any = null
let selectFields: any = null

const queryChain = {
  from: vi.fn().mockImplementation((table) => {
    lastTableQueried = table
    return queryChain
  }),
  where: vi.fn().mockImplementation(() => {
    return queryChain
  }),
  orderBy: vi.fn().mockImplementation(() => {
    return queryChain
  }),
  limit: vi.fn().mockImplementation((lim) => {
    if (lastTableQueried === schema.pipelineRuns) {
      if (selectFields) {
        // Query 2
        return Promise.resolve(mockPipelineRuns.map(r => ({ runId: r.runId })).slice(0, lim))
      }
      // Query 1
      return Promise.resolve(mockPipelineRuns.slice(0, lim))
    }
    return Promise.resolve([])
  }),
  then: vi.fn().mockImplementation((resolve) => {
    if (lastTableQueried === schema.deliberationMessages) {
      return Promise.resolve(mockDeliberationMessages).then(resolve)
    }
    return Promise.resolve([]).then(resolve)
  })
}

// Make queryChain a thenable
Object.defineProperty(queryChain, 'then', {
  value: function (resolve: any) {
    if (lastTableQueried === schema.deliberationMessages) {
      return Promise.resolve(mockDeliberationMessages).then(resolve)
    }
    return Promise.resolve([]).then(resolve)
  },
  configurable: true,
  writable: true
})

vi.mock('../../lib/db', () => {
  return {
    db: {
      select: vi.fn().mockImplementation((fields) => {
        selectFields = fields
        return queryChain
      })
    }
  }
})

describe('Oracle Cross-Run Consistency Validator Unit Tests', () => {
  beforeEach(() => {
    mockPipelineRuns = []
    mockDeliberationMessages = []
    lastTableQueried = null
    selectFields = null
  })

  const baseMessage: DeliberationMessage = {
    message_id: 'msg-current',
    pipeline_run_id: 'run-current',
    timestamp: new Date().toISOString(),
    sender: 'SOMA',
    message_type: 'FUND_REPORT',
    recipient: 'ALL',
    payload: {
      scheme_code: '120150',
      scheme_name: 'Axis Bluechip Fund',
      key_metrics: {
        returns: {
          '1y': 12.5,
          '3y': 15.2,
          '5y': 14.1
        },
        expense_ratio: 0.85,
        aum_cr: 12000,
        sharpe_3y: 1.1,
        sortino_3y: 1.3
      }
    },
    oracle_validation: { status: 'PENDING', flags: [] },
    references: []
  }

  it('should accept if no previous runs exist', async () => {
    const msg = { ...baseMessage, pipeline_run_id: 'run-1' }
    mockPipelineRuns = [{ runId: 'run-1', clientId: 'user-123' }]
    mockDeliberationMessages = []

    const result = await validateCrossRunConsistency('SOMA', msg)
    expect(result.consistent).toBe(true)
    expect(result.anomalies).toHaveLength(0)
    expect(result.recommendation).toBe('ACCEPT')
  })

  it('should accept if previous run values are identical or within limits', async () => {
    const msg = { ...baseMessage, pipeline_run_id: 'run-2' }
    mockPipelineRuns = [
      { runId: 'run-2', clientId: 'user-123' },
      { runId: 'run-prev-1', clientId: 'user-123' }
    ]

    mockDeliberationMessages = [
      {
        messageId: 'msg-prev',
        pipelineRunId: 'run-prev-1',
        sender: 'SOMA',
        messageType: 'FUND_REPORT',
        timestamp: new Date(Date.now() - 10000),
        payload: {
          scheme_code: '120150',
          key_metrics: {
            returns: {
              '1y': 12.0,
              '3y': 14.8,
              '5y': 13.9
            },
            expense_ratio: 0.80,
            aum_cr: 11000,
            sharpe_3y: 1.0,
            sortino_3y: 1.25
          }
        }
      }
    ]

    const result = await validateCrossRunConsistency('SOMA', msg)
    expect(result.consistent).toBe(true)
    expect(result.anomalies).toHaveLength(0)
    expect(result.recommendation).toBe('ACCEPT')
  })

  it('should flag for review if drift is moderate (between 1x and 2x threshold)', async () => {
    const msg = { ...baseMessage, pipeline_run_id: 'run-3' }
    mockPipelineRuns = [
      { runId: 'run-3', clientId: 'user-123' },
      { runId: 'run-prev-1', clientId: 'user-123' }
    ]

    mockDeliberationMessages = [
      {
        messageId: 'msg-prev',
        pipelineRunId: 'run-prev-1',
        sender: 'SOMA',
        messageType: 'FUND_REPORT',
        timestamp: new Date(Date.now() - 10000),
        payload: {
          scheme_code: '120150',
          key_metrics: {
            returns: {
              '1y': 12.5,
              '3y': 10.0,
              '5y': 14.1
            },
            expense_ratio: 0.85,
            aum_cr: 12000,
            sharpe_3y: 1.1,
            sortino_3y: 1.3
          }
        }
      }
    ]

    const result = await validateCrossRunConsistency('SOMA', msg)
    expect(result.consistent).toBe(false)
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].field).toBe('fund_3yr_return')
    expect(result.anomalies[0].severity).toBe('WARN')
    expect(result.recommendation).toBe('FLAG_FOR_REVIEW')
  })

  it('should reject if drift is critical (exceeds 2x threshold)', async () => {
    const msg = { ...baseMessage, pipeline_run_id: 'run-4' }
    mockPipelineRuns = [
      { runId: 'run-4', clientId: 'user-123' },
      { runId: 'run-prev-1', clientId: 'user-123' }
    ]

    mockDeliberationMessages = [
      {
        messageId: 'msg-prev',
        pipelineRunId: 'run-prev-1',
        sender: 'SOMA',
        messageType: 'FUND_REPORT',
        timestamp: new Date(Date.now() - 10000),
        payload: {
          scheme_code: '120150',
          key_metrics: {
            returns: {
              '1y': 12.5,
              '3y': 4.0,
              '5y': 14.1
            },
            expense_ratio: 0.85,
            aum_cr: 12000,
            sharpe_3y: 1.1,
            sortino_3y: 1.3
          }
        }
      }
    ]

    const result = await validateCrossRunConsistency('SOMA', msg)
    expect(result.consistent).toBe(false)
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].field).toBe('fund_3yr_return')
    expect(result.anomalies[0].severity).toBe('CRITICAL')
    expect(result.recommendation).toBe('REJECT')
  })

  it('should validate relative drift check for AUM', async () => {
    const msg = { ...baseMessage, pipeline_run_id: 'run-5' }
    mockPipelineRuns = [
      { runId: 'run-5', clientId: 'user-123' },
      { runId: 'run-prev-1', clientId: 'user-123' }
    ]

    mockDeliberationMessages = [
      {
        messageId: 'msg-prev',
        pipelineRunId: 'run-prev-1',
        sender: 'SOMA',
        messageType: 'FUND_REPORT',
        timestamp: new Date(Date.now() - 10000),
        payload: {
          scheme_code: '120150',
          key_metrics: {
            returns: { '1y': 12.5, '3y': 15.2, '5y': 14.1 },
            expense_ratio: 0.85,
            aum_cr: 5000,
            sharpe_3y: 1.1,
            sortino_3y: 1.3
          }
        }
      }
    ]

    const result = await validateCrossRunConsistency('SOMA', msg)
    expect(result.consistent).toBe(false)
    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0].field).toBe('aum')
    expect(result.anomalies[0].severity).toBe('CRITICAL')
    expect(result.recommendation).toBe('REJECT')
  })
})
