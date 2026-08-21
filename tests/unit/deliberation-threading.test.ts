import 'dotenv/config'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '../../lib/db'
import { deliberationMessages } from '../../db/schema'
import { DeliberationRoom } from '../../lib/deliberation/deliberation-room'
import { eq } from 'drizzle-orm'

describe('Deliberation Room Threading Integrity', () => {
  let room: DeliberationRoom
  let pipelineRunId: string

  beforeEach(async () => {
    room = new DeliberationRoom(db)
    pipelineRunId = randomUUID()
  })

  afterEach(async () => {
    await db.delete(deliberationMessages).where(eq(deliberationMessages.pipelineRunId, pipelineRunId))
  })

  it('PRIYA send() -> returns message ID and acts as root', async () => {
    const messageId = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: { test: 'root' }
    })

    expect(messageId).toBeDefined()

    const [msg] = await db.select().from(deliberationMessages).where(eq(deliberationMessages.messageId, messageId))
    expect(msg).toBeDefined()
    expect(msg.replyToMessageId).toBeNull()
    expect(msg.threadRootId).toBe(messageId)
    expect(msg.depth).toBe(0)
  })

  it('ARIA send(critique, replyTo: priyaId) -> succeeds, FK satisfied', async () => {
    const priyaId = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: { test: 'root' }
    })

    const ariaId = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: { test: 'child' }
    }, priyaId)

    const [msg] = await db.select().from(deliberationMessages).where(eq(deliberationMessages.messageId, ariaId))
    expect(msg).toBeDefined()
    expect(msg.replyToMessageId).toBe(priyaId)
    expect(msg.threadRootId).toBe(priyaId)
    expect(msg.depth).toBe(1)
  })

  it('ARIA send(critique, replyTo: nonexistent-id) -> graceful fallback to root', async () => {
    const nonexistentId = randomUUID()

    const ariaId = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: { test: 'fallback' }
    }, nonexistentId)

    const [msg] = await db.select().from(deliberationMessages).where(eq(deliberationMessages.messageId, ariaId))
    expect(msg).toBeDefined()
    expect(msg.replyToMessageId).toBeNull() // Graceful fallback
    expect(msg.threadRootId).toBe(ariaId)
    expect(msg.depth).toBe(0)
  })

  it('Thread tree reconstructed correctly: PRIYA(0) -> ARIA(1) -> PRIYA(2)', async () => {
    const priya0Id = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: { test: 'root' }
    })

    const aria1Id = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'ARIA',
      recipient: 'ALL',
      message_type: 'CRITIQUE',
      payload: { test: 'child' }
    }, priya0Id)

    const priya2Id = await room.send({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      recipient: 'ALL',
      message_type: 'PORTFOLIO_DRAFT',
      payload: { test: 'grandchild' }
    }, aria1Id)

    const messages = await db.select().from(deliberationMessages).where(eq(deliberationMessages.pipelineRunId, pipelineRunId))
    
    const priya0 = messages.find(m => m.messageId === priya0Id)
    const aria1 = messages.find(m => m.messageId === aria1Id)
    const priya2 = messages.find(m => m.messageId === priya2Id)

    expect(priya0?.threadRootId).toBe(priya0Id)
    
    expect(aria1?.replyToMessageId).toBe(priya0Id)
    expect(aria1?.threadRootId).toBe(priya0Id)
    expect(aria1?.depth).toBe(1)

    expect(priya2?.replyToMessageId).toBe(aria1Id)
    expect(priya2?.threadRootId).toBe(priya0Id) // Root should still be priya0Id
    expect(priya2?.depth).toBe(2)
  })
})
