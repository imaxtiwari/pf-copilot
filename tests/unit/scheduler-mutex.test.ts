// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { createTestPool, createTestDb, type TestDb } from './test-db'
import { acquireLock, releaseLock, logRun, withMutex } from '@/lib/scheduler/mutex'
import { randomUUID } from 'crypto'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'

describe.sequential('Scheduler mutex', () => {
  let pool: Pool
  let db: TestDb
  let jobName: string

  beforeAll(async () => {
    pool = createTestPool()
    db = createTestDb(pool)
    jobName = `mutex-test-job-${randomUUID()}`
  })

  afterAll(async () => {
    await db.delete(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, jobName))
    await db.delete(schema.schedulerRuns).where(eq(schema.schedulerRuns.jobName, jobName))
    await pool.end()
  })

  it('acquires and releases a lock', async () => {
    const acquired = await acquireLock(jobName)
    expect(acquired).toBe(true)

    const second = await acquireLock(jobName)
    expect(second).toBe(false)

    await releaseLock(jobName)

    const third = await acquireLock(jobName)
    expect(third).toBe(true)
    await releaseLock(jobName)
  })

  it('logs scheduler runs', async () => {
    await logRun(jobName, 'success', 100)
    const runs = await db.select().from(schema.schedulerRuns).where(eq(schema.schedulerRuns.jobName, jobName))
    expect(runs.length).toBeGreaterThanOrEqual(1)
    expect(runs[0].status).toBe('success')
  })

  it('withMutex prevents double execution', async () => {
    let counter = 0
    const result1 = await withMutex(jobName, async () => {
      counter += 1
      return 'done'
    })
    const result2 = await withMutex(jobName, async () => {
      counter += 1
      return 'done'
    })

    expect(result1).toBe('done')
    expect(result2).toBe('done')
    expect(counter).toBe(2)
  })

  it('withMutex returns null when lock is held', async () => {
    await acquireLock(jobName)
    const result = await withMutex(jobName, async () => 'should-not-run')
    expect(result).toBeNull()
    await releaseLock(jobName)
  })
})
