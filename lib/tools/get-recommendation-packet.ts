import { eq, desc, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'

export async function getRecommendationPacket(userId: string) {
  // Find the latest pipeline run for this user
  const latestRuns = await db
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.clientId, userId))
    .orderBy(desc(schema.pipelineRuns.startedAt))
    .limit(1)

  if (latestRuns.length === 0) {
    return { status: 'no_recommendation_yet' }
  }

  const latestRun = latestRuns[0]

  if (latestRun.status === 'IN_PROGRESS') {
    return { status: 'pipeline_in_progress' }
  }

  // Look for a 'packet' result associated with this run
  const results = await db
    .select()
    .from(schema.pipelineResults)
    .where(
      and(
        eq(schema.pipelineResults.pipelineRunId, latestRun.runId),
        eq(schema.pipelineResults.resultType, 'packet')
      )
    )
    .orderBy(desc(schema.pipelineResults.createdAt))
    .limit(1)

  if (results.length === 0) {
    return { status: 'no_recommendation_yet' }
  }

  const packetData = results[0].data as any

  // Fetch comparison report if it exists
  const comparisonReports = await db
    .select()
    .from(schema.comparisonReports)
    .where(eq(schema.comparisonReports.pipelineRunId, latestRun.runId))
    .limit(1)
  
  const comparisonReport = comparisonReports.length > 0 ? comparisonReports[0].report : null

  return {
    status: 'approved',
    approved_at: results[0].createdAt,
    portfolio_draft: packetData.portfolio_draft || packetData,
    confidence_score: packetData.confidence_score_breakdown?.total || packetData.confidence_score,
    comparison_report: comparisonReport
  }
}
