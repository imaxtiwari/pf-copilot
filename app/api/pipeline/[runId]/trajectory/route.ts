import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq, asc } from 'drizzle-orm'
import logger from '@/lib/logger'

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params

  try {
    const run = await db.query.pipelineRuns.findFirst({
      where: eq(schema.pipelineRuns.runId, runId)
    })

    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    const drafts = await db
      .select()
      .from(schema.portfolioDrafts)
      .where(eq(schema.portfolioDrafts.pipelineRunId, runId))
      .orderBy(asc(schema.portfolioDrafts.version))

    const trajectory = drafts.map((draft: typeof schema.portfolioDrafts.$inferSelect) => {
      let outcome = 'IN_PROGRESS'
      
      if (draft.version === drafts[drafts.length - 1].version) {
        if (run.status === 'APPROVED') outcome = 'APPROVED'
        else if (run.status === 'DEADLOCKED') outcome = 'DEADLOCK'
        else if (run.status === 'FAILED') outcome = 'FAILED'
        else outcome = 'IN_PROGRESS'
      } else {
        outcome = 'REVISION'
      }

      const defaultFaults = { CRITICAL: 0, MAJOR: 0, MINOR: 0, OBSERVATION: 0 }
      const ariaFaults = draft.ariaFaultCount || defaultFaults

      return {
        revisionCycle: draft.version,
        confidenceScore: parseFloat(draft.confidenceScore),
        ariaFaults,
        timestamp: draft.createdAt?.toISOString() || new Date().toISOString(),
        outcome
      }
    })

    return NextResponse.json({ pipelineRunId: runId, trajectory })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to fetch confidence trajectory')
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
