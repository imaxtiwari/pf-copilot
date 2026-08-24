import { NextResponse } from 'next/server'
import { inngest } from '@/lib/jobs/client'
import { IngestionJobType } from '@/lib/jobs/definitions'
import { ok, err } from '@/lib/contracts/error-envelope'
import logger from '@/lib/logger'

const INGESTION_JOBS = [
  { name: IngestionJobType.AMFI, data: {} },
  { name: IngestionJobType.FACTSHEETS, data: {} },
  { name: IngestionJobType.ANNUAL_REPORTS, data: {} },
]

/**
 * GET /api/scheduler
 * Returns the list of ingestion jobs that would be enqueued by a POST.
 */
export async function GET() {
  return NextResponse.json(ok({ jobs: INGESTION_JOBS.map((j) => j.name) }))
}

/**
 * POST /api/scheduler
 * Enqueues nightly data ingestion jobs and returns immediately.
 * No long-running work is performed inside the HTTP handler.
 */
export async function POST() {
  try {
    const { ids } = await inngest.send(INGESTION_JOBS)
    logger.info({ eventIds: ids, count: INGESTION_JOBS.length }, 'scheduler: enqueued ingestion jobs')
    return NextResponse.json(ok({ enqueued: INGESTION_JOBS.length, eventIds: ids }))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error({ error: message }, 'scheduler: failed to enqueue ingestion jobs')
    return NextResponse.json(err('QUEUE_ERROR', message), { status: 500 })
  }
}
