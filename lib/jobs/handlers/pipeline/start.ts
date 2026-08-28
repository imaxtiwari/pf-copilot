import { eq } from 'drizzle-orm'
import { inngest } from '../../client'
import { db } from '../../../db'
import * as schema from '../../../../db/schema'
import { PipelineJobType, type PipelineJobPayloadMap } from '../../definitions'
import { generateInsight, persistInsight } from '../../../portfolio/insights'
import logger from '../../../logger'

const RETRY_POLICY = 3

type PipelineStep = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
}

type PipelineContext = {
  userId: string
  uploadId: string
}

async function createRun(ctx: PipelineContext): Promise<string> {
  const [run] = await db
    .insert(schema.pipelineRuns)
    .values({
      clientId: ctx.userId,
      status: 'RUNNING',
      stage: 'INTAKE',
      payload: { uploadId: ctx.uploadId },
    })
    .returning({ runId: schema.pipelineRuns.runId })

  logger.info({ runId: run.runId, userId: ctx.userId, uploadId: ctx.uploadId }, 'pipeline: run created')
  return run.runId
}

async function loadHoldings(ctx: PipelineContext & { runId: string }): Promise<number> {
  const holdings = await db.query.portfolioHoldings.findMany({
    where: (h, { eq, and }) => and(eq(h.userId, ctx.userId), eq(h.casUploadId, ctx.uploadId)),
  })

  await db
    .update(schema.pipelineRuns)
    .set({ stage: 'PROFILING_AND_GOAL_ASSESSMENT', updatedAt: new Date() })
    .where(eq(schema.pipelineRuns.runId, ctx.runId))

  logger.info({ runId: ctx.runId, holdingsCount: holdings.length }, 'pipeline: holdings loaded')
  return holdings.length
}

async function generatePipelineInsight(ctx: PipelineContext & { runId: string }): Promise<void> {
  const insight = await generateInsight({ userId: ctx.userId, uploadId: ctx.uploadId })
  await persistInsight(insight)

  await db
    .update(schema.pipelineRuns)
    .set({ stage: 'PDF_GENERATION', updatedAt: new Date() })
    .where(eq(schema.pipelineRuns.runId, ctx.runId))

  logger.info({ runId: ctx.runId }, 'pipeline: insight generated')
}

async function finalizeRun(runId: string): Promise<void> {
  await db
    .update(schema.pipelineRuns)
    .set({ status: 'COMPLETED', stage: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.pipelineRuns.runId, runId))

  logger.info({ runId }, 'pipeline: finalized')
}

async function markFailed(runId: string | undefined, error: unknown): Promise<void> {
  if (!runId) return
  try {
    await db
      .update(schema.pipelineRuns)
      .set({ status: 'FAILED', stage: 'FAILED', updatedAt: new Date() })
      .where(eq(schema.pipelineRuns.runId, runId))
  } catch (dbErr) {
    logger.error({ runId, error: dbErr }, 'pipeline: failed to mark run as failed')
  }
  logger.error({ runId, error: error instanceof Error ? error.message : String(error) }, 'pipeline: marked failed')
}

export async function handlePipelineStart(
  event: { data: PipelineJobPayloadMap[typeof PipelineJobType.PIPELINE_START] },
  step: PipelineStep,
): Promise<{ runId: string; status: string }> {
  const { userId, uploadId } = event.data
  let runId: string | undefined

  try {
    runId = await step.run('intake', async () => createRun({ userId, uploadId }))
    await step.run('load-holdings', async () => loadHoldings({ userId, uploadId, runId: runId! }))
    await step.run('generate-insight', async () => generatePipelineInsight({ userId, uploadId, runId: runId! }))
    await step.run('finalize', async () => finalizeRun(runId!))

    logger.info({ runId, userId, uploadId }, 'pipeline: completed')
    return { runId, status: 'COMPLETED' }
  } catch (error) {
    await step.run('mark-failed', async () => markFailed(runId, error))
    logger.error(
      { userId, uploadId, runId, error: error instanceof Error ? error.message : String(error) },
      'pipeline: failed',
    )
    throw error
  }
}

export const pipelineStartFunction = inngest.createFunction(
  { id: 'pipeline-start', retries: RETRY_POLICY },
  { event: PipelineJobType.PIPELINE_START },
  async ({ event, step }) =>
    handlePipelineStart(
      event as { data: PipelineJobPayloadMap[typeof PipelineJobType.PIPELINE_START] },
      step as unknown as PipelineStep,
    ),
)
