import { randomUUID } from 'crypto'
import { eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import logger from '@/lib/logger'

export const INSTANCE_UUID = randomUUID()

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Attempt to acquire a scheduler lock for `jobName`.
 * If a lock exists but is older than `ttlMs`, it is considered stale and reclaimed.
 * Returns true if this instance now holds the lock.
 */
export async function acquireLock(jobName: string, ttlMs = DEFAULT_LOCK_TTL_MS): Promise<boolean> {
  const now = new Date()
  const staleThreshold = new Date(now.getTime() - ttlMs)

  try {
    // Reclaim stale locks so crashed instances cannot block the job forever.
    await db
      .delete(schema.schedulerLocks)
      .where(eq(schema.schedulerLocks.jobName, jobName))
      .where(lt(schema.schedulerLocks.lockedAt, staleThreshold))
  } catch (err) {
    logger.warn({ err, jobName }, 'MUTEX: Failed to clean stale locks')
  }

  try {
    const inserted = await db
      .insert(schema.schedulerLocks)
      .values({
        jobName,
        lockedAt: now,
        lockedBy: INSTANCE_UUID,
      })
      .onConflictDoNothing()
      .returning({ lockedBy: schema.schedulerLocks.lockedBy })

    // If the insert returned a row, this instance won the race.
    return inserted.length > 0 && inserted[0].lockedBy === INSTANCE_UUID
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to acquire lock')
    return false
  }
}

/** Release a scheduler lock held by this instance. */
export async function releaseLock(jobName: string): Promise<void> {
  try {
    await db
      .delete(schema.schedulerLocks)
      .where(eq(schema.schedulerLocks.jobName, jobName))
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to release lock')
  }
}

/** Log a scheduler run outcome to `scheduler_runs`. */
export async function logRun(
  jobName: string,
  status: 'success' | 'failed',
  durationMs: number,
  errorMsg?: string,
): Promise<void> {
  try {
    await db.insert(schema.schedulerRuns).values({
      jobName,
      status,
      startedAt: new Date(Date.now() - durationMs),
      finishedAt: new Date(),
      metadata: { durationMs, errorMsg },
    })
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to log run')
  }
}

/**
 * Convenience wrapper: acquire lock, run callback, release lock, log outcome.
 * Returns the callback result, or null if the lock could not be acquired.
 */
export async function withMutex<T>(
  jobName: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_LOCK_TTL_MS,
): Promise<T | null> {
  const acquired = await acquireLock(jobName, ttlMs)
  if (!acquired) return null

  const startedAt = Date.now()
  let status: 'success' | 'failed' = 'success'
  let errorMsg: string | undefined

  try {
    return await fn()
  } catch (err) {
    status = 'failed'
    errorMsg = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    await logRun(jobName, status, Date.now() - startedAt, errorMsg)
    await releaseLock(jobName)
  }
}
