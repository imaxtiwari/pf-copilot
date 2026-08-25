// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { createTestPool, createTestDb, type TestDb } from './test-db'
import { acquireLock, releaseLock, logRun, withMutex } from '@/lib/scheduler/mutex'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'
const JOB_NAME = 'mutex-test-job'

describe('Scheduler mutex', () => {
  let pool: Pool
  let db: TestDb

  beforeAll(async () => {
    pool = createTestPool()
    db = createTestDb(pool)
    await db.delete(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, JOB_NAME))
    await db.delete(schema.schedulerRuns).where(eq(schema.schedulerRuns.jobName, JOB_NAME))
  })

  afterAll(async () => {
    await db.delete(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, JOB_NAME))
    await db.delete(schema.schedulerRuns).where(eq(schema.schedulerRuns.jobName, JOB_NAME))
    await pool.end()
  })

  it('acquires and releases a lock', async () => {
    const acquired = await acquireLock(JOB_NAME)
    expect(acquired).toBe(true)

    const second = await acquireLock(JOB_NAME)
    expect(second).toBe(false)

    await releaseLock(JOB_NAME)

    const third = await acquireLock(JOB_NAME)
    expect(third).toBe(true)
    await releaseLock(JOB_NAME)
  })

  it('logs scheduler runs', async () => {
    await logRun(JOB_NAME, 'success', 100)
    const runs = await db.select().from(schema.schedulerRuns).where(eq(schema.schedulerRuns.jobName, JOB_NAME))
    expect(runs.length).toBeGreaterThanOrEqual(1)
    expect(runs[0].status).toBe('success')
  })

  it('withMutex prevents double execution', async () => {
    let counter = 0
    const result1 = await withMutex(JOB_NAME, async () => {
      counter += 1
      return 'done'
    })
    const result2 = await withMutex(JOB_NAME, async () => {
      counter += 1
      return 'done'
    })

    expect(result1).toBe('done')
    expect(result2).toBe('done')
    expect(counter).toBe(2)
  })

  it('withMutex returns null when lock is held', async () => {
    await acquireLock(JOB_NAME)
    const result = await withMutex(JOB_NAME, async () => 'should-not-run')
    expect(result).toBeNull()
    await releaseLock(JOB_NAME)
  })
})
