import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'
import logger from '@/lib/logger'

export const INSTANCE_UUID = randomUUID()

export async function acquireLock(jobName: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes TTL
  try {
    const result = await db.insert(schema.schedulerLocks).values({
      jobName,
      lockedAt: new Date(),
      lockedBy: INSTANCE_UUID,
      expiresAt,
    }).onConflictDoNothing().returning()

    return result.length > 0
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to acquire lock')
    return false
  }
}

export async function releaseLock(jobName: string): Promise<void> {
  try {
    await db.delete(schema.schedulerLocks).where(eq(schema.schedulerLocks.jobName, jobName))
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to release lock')
  }
}

export async function logRun(jobName: string, status: 'success' | 'failed', durationMs: number, errorMsg?: string): Promise<void> {
  try {
    await db.insert(schema.schedulerRuns).values({
      jobName,
      firedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
      status,
      durationMs,
      errorMsg,
    })
  } catch (err) {
    logger.error({ err, jobName }, 'MUTEX: Failed to log run')
  }
}
