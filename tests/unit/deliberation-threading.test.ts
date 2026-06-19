import { describe, it, expect, vi } from 'vitest'
import { DeliberationRoom } from '../../lib/deliberation/deliberation-room'

describe('Deliberation Room Threading Unit Tests', () => {
  it('should publish a root message with depth 0 and threadRootId equal to messageId', async () => {
    const room = new DeliberationRoom()
    const msg = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 1,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: []
    })

    expect(msg.depth).toBe(0)
    expect(msg.thread_root_id).toBe(msg.message_id)
    expect(msg.reply_to_message_id).toBeNull()
  })

  it('should publish a reply message with depth 1 and correct references', async () => {
    const room = new DeliberationRoom()
    const rootMsg = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 1,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: []
    })

    const replyMsg = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: {
        target_message_id: rootMsg.message_id,
        critique_points: ['concentration is too high'],
        severity: 'HIGH',
        recommended_action: 'Reduce IT allocation'
      },
      references: [rootMsg.message_id]
    }, rootMsg.message_id)

    expect(replyMsg.depth).toBe(1)
    expect(replyMsg.thread_root_id).toBe(rootMsg.message_id)
    expect(replyMsg.reply_to_message_id).toBe(rootMsg.message_id)
  })

  it('should increment depth and keep same root for subsequent replies', async () => {
    const room = new DeliberationRoom()
    const rootMsg = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 1,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: []
    })

    const reply1 = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: {
        target_message_id: rootMsg.message_id,
        critique_points: ['concentration is too high'],
        severity: 'HIGH',
        recommended_action: 'Reduce IT allocation'
      },
      references: [rootMsg.message_id]
    }, rootMsg.message_id)

    const reply2 = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 2,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: [reply1.message_id]
    }, reply1.message_id)

    expect(reply2.depth).toBe(2)
    expect(reply2.thread_root_id).toBe(rootMsg.message_id)
    expect(reply2.reply_to_message_id).toBe(reply1.message_id)
  })

  it('should return receiveThread sorted by depth then timestamp', async () => {
    const room = new DeliberationRoom()
    const rootMsg = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 1,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: []
    })

    const reply1 = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: {
        target_message_id: rootMsg.message_id,
        critique_points: ['concentration is too high'],
        severity: 'HIGH',
        recommended_action: 'Reduce IT allocation'
      },
      references: [rootMsg.message_id]
    }, rootMsg.message_id)

    const reply2 = await room.publish({
      pipeline_run_id: 'run-1',
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: {
        draft_version: 2,
        client_id: 'c-1',
        holdings: [],
        total_allocation_pct: 0
      },
      references: [reply1.message_id]
    }, reply1.message_id)

    const thread = await room.receiveThread(rootMsg.message_id)
    expect(thread).toHaveLength(3)
    expect(thread[0].message_id).toBe(rootMsg.message_id)
    expect(thread[1].message_id).toBe(reply1.message_id)
    expect(thread[2].message_id).toBe(reply2.message_id)
  })
})
