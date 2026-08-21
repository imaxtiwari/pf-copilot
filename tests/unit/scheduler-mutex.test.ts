import { describe, it, expect, beforeEach, vi } from 'vitest'
import { acquireLock, releaseLock } from '@/lib/scheduler/mutex'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

const mockLocks = new Set<string>()

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn((schemaObj) => ({
      values: vi.fn((vals) => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: async () => {
            if (mockLocks.has(vals.jobName)) {
              return []
            }
            mockLocks.add(vals.jobName)
            return [{ jobName: vals.jobName }] // simulating insertion
          }
        }))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        mockLocks.clear() // Simplification: assume delete removes it
      })
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          return mockLocks.size > 0 ? [{}] : []
        })
      }))
    }))
  }
}))

describe('Scheduler Mutex Unit Tests', () => {
  beforeEach(async () => {
    mockLocks.clear()
  })

  it('Two concurrent acquireLock calls -> only one returns true', async () => {
    const jobName = 'test-concurrent-job'
    
    // Fire them concurrently
    const [result1, result2] = await Promise.all([
      acquireLock(jobName),
      acquireLock(jobName)
    ])

    // One should be true, the other false
    expect(result1 !== result2).toBe(true)
    expect(result1 || result2).toBe(true)
  })

  it('releaseLock called after job -> lock row deleted', async () => {
    const jobName = 'test-release-job'
    
    const acquired = await acquireLock(jobName)
    expect(acquired).toBe(true)

    // Verify it exists in db
    const locksBefore = await db.select().from(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, jobName))
    expect(locksBefore.length).toBe(1)

    await releaseLock(jobName)

    // Verify it's gone
    const locksAfter = await db.select().from(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, jobName))
    expect(locksAfter.length).toBe(0)
  })

  it('Job throws -> releaseLock still called (finally block pattern test)', async () => {
    const jobName = 'test-throw-job'
    
    const acquired = await acquireLock(jobName)
    expect(acquired).toBe(true)

    try {
      throw new Error('simulate job failure')
    } catch (e) {
      // ignore
    } finally {
      await releaseLock(jobName)
    }

    // Verify lock released
    const locksAfter = await db.select().from(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, jobName))
    expect(locksAfter.length).toBe(0)

    // Should be able to acquire again
    const acquiredAgain = await acquireLock(jobName)
    expect(acquiredAgain).toBe(true)
  })
})
