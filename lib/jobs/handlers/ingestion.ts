import { createHash } from 'node:crypto'
import { eq, and, sql } from 'drizzle-orm'
import { inngest } from '../client'
import { db, type DbClient } from '../../db'
import * as schema from '../../../db/schema'
import { syncAmfiMaster } from '../../ingestion/amfi'
import { ingestFactsheets } from '../../ingestion/factsheets'
import { ingestAnnualReports } from '../../ingestion/annual-reports'
import logger from '../../logger'
import { IngestionJobType, type IngestionJobPayloadMap } from '../definitions'

const RETRY_POLICY = 3

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function upsertRunStart(
  jobType: string,
  payloadHash: string,
): Promise<{ runId: string; wasCompleted: boolean; previousResult: unknown | null }> {
  const existing = await db.query.ingestionRuns.findFirst({
    where: and(
      eq(schema.ingestionRuns.jobType, jobType),
      eq(schema.ingestionRuns.payloadHash, payloadHash),
    ),
  })

  if (!existing) {
    const [row] = await db
      .insert(schema.ingestionRuns)
      .values({
        jobType,
        payloadHash,
        status: 'running',
        startedAt: new Date(),
        attemptCount: 1,
      })
      .returning({ id: schema.ingestionRuns.id })
    return { runId: row.id, wasCompleted: false, previousResult: null }
  }

  await db
    .update(schema.ingestionRuns)
    .set({
      status: 'running',
      startedAt: new Date(),
      attemptCount: sql`${schema.ingestionRuns.attemptCount} + 1`,
      errorMessage: null,
    })
    .where(eq(schema.ingestionRuns.id, existing.id))

  return {
    runId: existing.id,
    wasCompleted: existing.status === 'completed',
    previousResult: existing.result,
  }
}

async function finishRun(
  runId: string,
  status: 'completed' | 'failed',
  result?: unknown,
  error?: unknown,
): Promise<void> {
  await db
    .update(schema.ingestionRuns)
    .set({
      status,
      finishedAt: new Date(),
      result: result ?? null,
      errorMessage: error instanceof Error ? error.message : error ? String(error) : null,
    })
    .where(eq(schema.ingestionRuns.id, runId))
}

type IngestionRunner<T> = (db: DbClient) => Promise<T>

export async function runIngestionJob<T>(
  jobType: string,
  payload: { force?: boolean },
  runner: IngestionRunner<T>,
): Promise<T> {
  const payloadHash = hashPayload(payload)
  const { runId, wasCompleted, previousResult } = await upsertRunStart(jobType, payloadHash)

  if (wasCompleted && !payload.force) {
    logger.info({ jobType, payloadHash }, 'ingestion: skipping completed job')
    return previousResult as T
  }

  try {
    logger.info({ jobType, payloadHash, runId }, 'ingestion: running')
    const result = await runner(db)
    await finishRun(runId, 'completed', result)
    logger.info({ jobType, payloadHash, runId }, 'ingestion: completed')
    return result
  } catch (error) {
    logger.error({ jobType, payloadHash, runId, error: error instanceof Error ? error.message : String(error) }, 'ingestion: failed')
    await finishRun(runId, 'failed', undefined, error)
    throw error
  }
}

export const ingestionFunctions: ReturnType<typeof inngest.createFunction>[] = [
  inngest.createFunction(
    { id: 'ingest-amfi', retries: RETRY_POLICY },
    { event: IngestionJobType.AMFI },
    async ({ event }) => {
      const data = event.data as IngestionJobPayloadMap[typeof IngestionJobType.AMFI]
      return runIngestionJob(IngestionJobType.AMFI, data, syncAmfiMaster)
    },
  ),
  inngest.createFunction(
    { id: 'ingest-factsheets', retries: RETRY_POLICY },
    { event: IngestionJobType.FACTSHEETS },
    async ({ event }) => {
      const data = event.data as IngestionJobPayloadMap[typeof IngestionJobType.FACTSHEETS]
      return runIngestionJob(IngestionJobType.FACTSHEETS, data, ingestFactsheets)
    },
  ),
  inngest.createFunction(
    { id: 'ingest-annual-reports', retries: RETRY_POLICY },
    { event: IngestionJobType.ANNUAL_REPORTS },
    async ({ event }) => {
      const data = event.data as IngestionJobPayloadMap[typeof IngestionJobType.ANNUAL_REPORTS]
      return runIngestionJob(IngestionJobType.ANNUAL_REPORTS, data, ingestAnnualReports)
    },
  ),
]
