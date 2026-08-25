// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import * as schema from '@/db/schema'
import { createTestPool, createTestDb, type TestDb } from './test-db'
import { DeliberationRoom, type BoundDeliberationRoom } from '@/lib/deliberation/deliberation-room'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'

describe.sequential('DeliberationRoom', () => {
  let pool: Pool
  let db: TestDb
  let userId: string
  let runId: string
  let room: BoundDeliberationRoom

  beforeAll(async () => {
    pool = createTestPool()
    db = createTestDb(pool)
    const unbound = new DeliberationRoom(db)

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id })
    userId = user.id

    const [run] = await db
      .insert(schema.pipelineRuns)
      .values({ clientId: userId, status: 'PENDING', stage: 'INTAKE' })
      .returning({ runId: schema.pipelineRuns.runId })
    runId = run.runId
    room = unbound.bind(runId)
  })

  afterAll(async () => {
    // cleanup intentionally skipped — local test DB accumulates rows but UUIDs keep assertions stable
    await pool.end()
  })

  it('publishes a valid message and returns it', async () => {
    const msg = await room.publish({
      sender: 'SOMA',
      user_id: userId,
      message_type: 'FUND_REPORT',
      recipient: 'ALL',
      content: 'Test report',
      payload: { scheme_code: 'INF209K01UN8' },
    } as any)

    expect(msg.message_id).toBeDefined()
    expect(msg.sender).toBe('SOMA')
    expect(msg.message_type).toBe('FUND_REPORT')
    expect(msg.pipeline_run_id).toBe(runId)
  })

  it('rejects invalid messages', async () => {
    await expect(
      room.publish({
        sender: 'UNKNOWN_AGENT',
        message_type: 'FUND_REPORT',
        recipient: 'ALL',
        content: '',
        payload: {},
      } as any),
    ).rejects.toThrow()
  })

  it('supports idempotent insertion by message_id', async () => {
    const first = await room.publish({
      sender: 'PRIYA',
      user_id: userId,
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      content: 'Draft v1',
      payload: { draft_version: 1 },
    } as any)

    const second = await room.publish({
      ...(first as any),
      sender: 'PRIYA',
      user_id: userId,
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      content: 'Draft v2',
      payload: { draft_version: 2 },
    } as any)

    expect(second.message_id).toBe(first.message_id)
  })

  it('loads history for a pipeline run', async () => {
    const history = await room.getHistory()
    expect(history.length).toBeGreaterThanOrEqual(2)
  })

  it('supports subscriptions', async () => {
    const received: any[] = []
    const unsubscribe = room.subscribe('ALL', (msg) => received.push(msg))

    await room.publish({
      sender: 'ARIA',
      user_id: userId,
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      content: 'Critique',
      payload: { severity: 'HIGH' },
    } as any)

    unsubscribe()
    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[received.length - 1].sender).toBe('ARIA')
  })
})
