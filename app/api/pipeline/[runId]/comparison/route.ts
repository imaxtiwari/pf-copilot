import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import logger from '@/lib/logger'

export async function GET(
  req: NextRequest,
  context: { params: any }
) {
  try {
    const { userId } = await resolveOrCreateUserId()
    const params = await context.params
    const runId = params.runId

    if (!runId) {
      return NextResponse.json(
        { error: 'Missing run ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const [run] = await db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.runId, runId))
      .limit(1)

    if (!run) {
      return NextResponse.json(
        { error: 'Pipeline run not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (run.clientId !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized access to this pipeline run', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const [comparison] = await db
      .select()
      .from(schema.comparisonReports)
      .where(eq(schema.comparisonReports.pipelineRunId, runId))
      .limit(1)

    if (!comparison) {
      return NextResponse.json(
        { error: 'Comparison report not found', code: 'COMPARISON_NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(comparison.report)
  } catch (err) {
    logger.error({ err }, 'API-COMPARISON: Failed to retrieve comparison report')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
