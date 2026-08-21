import { describe, it, expect, vi, beforeAll } from 'vitest'
import { randomUUID } from 'crypto'

// Setup in-memory SQLite for audit trail
process.env.AUDIT_TRAIL_DB_PATH = ':memory:'

// Mock Qdrant and Azure OpenAI using classes
vi.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: class MockQdrant {
      getCollections = vi.fn().mockResolvedValue({ collections: [] })
      createCollection = vi.fn().mockResolvedValue({})
      upsert = vi.fn().mockResolvedValue({})
      search = vi.fn().mockResolvedValue([])
      setPayload = vi.fn().mockResolvedValue({})
      scroll = vi.fn().mockResolvedValue({ points: [] })
    }
  }
})

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

import { DeliberationRoom } from '../../lib/deliberation/deliberation-room'
import { oracleMiddleware } from '../../lib/oracle/oracle'
import { auditTrail, AuditActionType } from '../../lib/audit/audit-trail'
import { DeliberationMessage } from '../../lib/deliberation/message-schema'

describe('Deliberation Room Integration Tests', () => {
  let room: DeliberationRoom

  beforeAll(() => {
    room = new DeliberationRoom()
    // Register Oracle middleware
    room.addMiddleware(oracleMiddleware)
  })

  it('should flow message through ORACLE, log to audit trail, and notify matching subscribers', async () => {
    const runId = `integration-run-${randomUUID()}`
    let messageReceived: DeliberationMessage | null = null

    // Use a unique subscription to avoid leakage
    const unsubscribe = room.subscribe('ARIA', (msg) => {
      if (msg.pipeline_run_id === runId) {
        messageReceived = msg
      }
    })

    const rawMsg = {
      pipeline_run_id: runId,
      sender: 'SOMA' as const,
      message_type: 'FUND_REPORT' as const,
      recipient: 'ALL' as const,
      payload: {
        fact: 'Soma report content'
      },
      references: []
    }

    const published = await room.publish(rawMsg)
    
    // Assert Oracle validation was attached
    expect(published.oracle_validation).toBeDefined()
    expect(published.oracle_validation.status).toBe('PASSED')

    // Assert Subscriber received the message
    expect(messageReceived).not.toBeNull()
    expect(messageReceived!.message_id).toBe(published.message_id)

    // Assert audit trail entry was created
    const logs = auditTrail.query({ pipeline_run_id: runId, action_type: AuditActionType.DELIBERATION_MESSAGE_SENT })
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0].payload_json).message_id).toBe(published.message_id)

    unsubscribe()
  })

  it('should deliver messages based on matching recipient filtering', async () => {
    const runId = `integration-run-filter-${randomUUID()}`
    let ariaReceivedCount = 0
    let kiranReceivedCount = 0

    const u1 = room.subscribe('ARIA', (msg) => {
      if (msg.pipeline_run_id === runId) ariaReceivedCount++
    })
    const u2 = room.subscribe('KIRAN', (msg) => {
      if (msg.pipeline_run_id === runId) kiranReceivedCount++
    })

    // Message 1: target ALL
    await room.publish({
      pipeline_run_id: runId,
      sender: 'DHRUV',
      message_type: 'DIRECTIVE',
      recipient: 'ALL',
      payload: { msg: 'Hello all' },
      references: []
    })

    // Message 2: target ARIA
    await room.publish({
      pipeline_run_id: runId,
      sender: 'DHRUV',
      message_type: 'DIRECTIVE',
      recipient: 'ARIA',
      payload: { msg: 'Hello Aria' },
      references: []
    })

    // Message 3: target KIRAN
    await room.publish({
      pipeline_run_id: runId,
      sender: 'DHRUV',
      message_type: 'DIRECTIVE',
      recipient: 'KIRAN',
      payload: { msg: 'Hello Kiran' },
      references: []
    })

    expect(ariaReceivedCount).toBe(2) // ALL + ARIA
    expect(kiranReceivedCount).toBe(2) // ALL + KIRAN

    u1()
    u2()
  })

  it('should return messages in chronological order via getHistory()', async () => {
    const runId = `integration-run-history-${randomUUID()}`

    const m1 = await room.publish({
      pipeline_run_id: runId,
      sender: 'SOMA',
      message_type: 'FUND_REPORT',
      recipient: 'ALL',
      payload: { step: 1 },
      references: []
    })

    const m2 = await room.publish({
      pipeline_run_id: runId,
      sender: 'PRIYA',
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      payload: { step: 2 },
      references: []
    })

    const history = await room.getHistory(runId)
    expect(history).toHaveLength(2)
    expect(history[0].message_id).toBe(m1.message_id)
    expect(history[1].message_id).toBe(m2.message_id)
  })

  it('should throw Zod error for invalid message format during publish()', async () => {
    const invalidMsg = {
      pipeline_run_id: 'invalid-run',
      sender: 'NON_EXISTENT_SENDER' as any,
      message_type: 'FUND_REPORT' as const,
      recipient: 'ALL' as const,
      payload: {},
      references: []
    }

    await expect(room.publish(invalidMsg)).rejects.toThrow()
  })
})
