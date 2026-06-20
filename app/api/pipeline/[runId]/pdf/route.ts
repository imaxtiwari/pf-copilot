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

    // Retrieve PDF from pipeline_results
    const [result] = await db
      .select()
      .from(schema.pipelineResults)
      .where(eq(schema.pipelineResults.pipelineRunId, runId))
      .limit(1)

    if (!result || !result.rationalePdfUrl) {
      return NextResponse.json(
        { error: 'Portfolio rationale PDF is not generated yet', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const pdfBase64 = result.rationalePdfUrl
    const buffer = Buffer.from(pdfBase64, 'base64')

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="portfolio-rationale-${runId}.pdf"`,
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (err) {
    logger.error({ err }, 'API-PDF: Failed to stream PDF')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
