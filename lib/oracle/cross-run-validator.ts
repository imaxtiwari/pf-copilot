import { eq, desc, and, ne, inArray } from 'drizzle-orm'
import type { DbClient } from '@/lib/db'
import * as schema from '@/db/schema'
import { DeliberationMessage } from '@/lib/deliberation/message-schema'
import logger from '@/lib/logger'

export interface CrossRunValidationResult {
  consistent: boolean
  anomalies: Array<{
    field: string
    previousValue: number
    currentValue: number
    delta: number
    previousRunId: string
    severity: 'CRITICAL' | 'WARN'
  }>
  recommendation: 'ACCEPT' | 'FLAG_FOR_REVIEW' | 'REJECT'
}

// In-memory cache to avoid repeated DB lookups for previous runs during the same pipeline run.
const previousMessagesCache = new Map<string, { previousMessages: any[]; timestamp: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour TTL

const MAX_DRIFT: Record<string, number> = {
  fund_1yr_return: 15,
  fund_3yr_return: 5,
  fund_5yr_return: 5,
  expense_ratio: 0.5,
  aum: 0.3, // 30% relative drift
  sharpe_ratio: 0.5,
  sortino_ratio: 0.5,
}

function extractMetrics(payload: any) {
  const keyMetrics = payload?.key_metrics || {}
  const returns = keyMetrics.returns || payload?.returns || {}
  const return_1yr = returns['1y'] ?? returns['1yr'] ?? payload?.return_1y ?? payload?.return_1yr
  const return_3yr = returns['3y'] ?? returns['3yr'] ?? payload?.return_3y ?? payload?.return_3yr
  const return_5yr = returns['5y'] ?? returns['5yr'] ?? payload?.return_5y ?? payload?.return_5yr
  const expense_ratio = keyMetrics.expense_ratio ?? payload?.expense_ratio
  const aum = keyMetrics.aum_cr ?? keyMetrics.aum ?? payload?.aum_cr ?? payload?.aum
  const sharpe = keyMetrics.sharpe_3y ?? keyMetrics.sharpe ?? payload?.sharpe_3y ?? payload?.sharpe
  const sortino = keyMetrics.sortino_3y ?? keyMetrics.sortino ?? payload?.sortino_3y ?? payload?.sortino

  return {
    fund_1yr_return: typeof return_1yr === 'number' ? return_1yr : null,
    fund_3yr_return: typeof return_3yr === 'number' ? return_3yr : null,
    fund_5yr_return: typeof return_5yr === 'number' ? return_5yr : null,
    expense_ratio: typeof expense_ratio === 'number' ? expense_ratio : null,
    aum: typeof aum === 'number' ? aum : null,
    sharpe_ratio: typeof sharpe === 'number' ? sharpe : null,
    sortino_ratio: typeof sortino === 'number' ? sortino : null,
  }
}

/**
 * Compare metrics for the same scheme_code across a user's previous pipeline
 * runs. Only numerical fund metrics are compared; no raw holdings or personal
 * data is exposed in the result.
 */
export async function validateCrossRunConsistency(
  dbClient: DbClient,
  agentId: string,
  currentMessage: DeliberationMessage,
  lookbackRuns: number = 5,
): Promise<CrossRunValidationResult> {
  const currentRunId = currentMessage.pipeline_run_id
  const schemeCode = currentMessage.payload?.scheme_code as string | undefined

  if (!schemeCode) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  const now = Date.now()
  const cached = previousMessagesCache.get(currentRunId)
  let prevMessages: any[] = []

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    prevMessages = cached.previousMessages
  } else {
    try {
      const [run] = await dbClient
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.runId, currentRunId))
        .limit(1)

      if (run?.clientId) {
        const previousRunsList = await dbClient
          .select()
          .from(schema.pipelineRuns)
          .where(
            and(
              eq(schema.pipelineRuns.clientId, run.clientId),
              ne(schema.pipelineRuns.runId, currentRunId),
            ),
          )
          .orderBy(desc(schema.pipelineRuns.startedAt))
          .limit(lookbackRuns)

        if (previousRunsList.length > 0) {
          const runIds = previousRunsList.map((r) => r.runId)
          const dbMessages = await dbClient
            .select()
            .from(schema.deliberationMessages)
            .where(and(inArray(schema.deliberationMessages.pipelineRunId, runIds), eq(schema.deliberationMessages.sender, agentId)))

          prevMessages = dbMessages
        }
      }

      previousMessagesCache.set(currentRunId, {
        previousMessages: prevMessages,
        timestamp: now,
      })
    } catch (err) {
      logger.error({ err, currentRunId }, 'Oracle CrossRunValidator: Failed to fetch previous runs or messages from DB')
      return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
    }
  }

  if (prevMessages.length === 0) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  const matchingMessages = prevMessages.filter((m: any) => {
    return m.messageType === currentMessage.message_type && m.payload?.scheme_code === schemeCode
  })

  if (matchingMessages.length === 0) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  matchingMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const prevMsg = matchingMessages[0]

  const currentMetrics = extractMetrics(currentMessage.payload)
  const prevMetrics = extractMetrics(prevMsg.payload)

  const anomalies: CrossRunValidationResult['anomalies'] = []
  const fields = Object.keys(MAX_DRIFT) as Array<keyof typeof MAX_DRIFT>

  for (const field of fields) {
    const currentVal = currentMetrics[field]
    const prevVal = prevMetrics[field]

    if (currentVal !== null && prevVal !== null) {
      let delta = 0
      let isAnomaly = false
      const threshold = MAX_DRIFT[field]

      if (field === 'aum') {
        if (prevVal !== 0) {
          delta = (currentVal - prevVal) / prevVal
          isAnomaly = Math.abs(delta) > threshold
        }
      } else {
        delta = currentVal - prevVal
        isAnomaly = Math.abs(delta) > threshold
      }

      if (isAnomaly) {
        const severity = Math.abs(delta) > 2 * threshold ? 'CRITICAL' : 'WARN'
        anomalies.push({
          field,
          previousValue: prevVal,
          currentValue: currentVal,
          delta,
          previousRunId: prevMsg.pipelineRunId,
          severity,
        })
      }
    }
  }

  const hasCritical = anomalies.some((a) => a.severity === 'CRITICAL')
  const recommendation = hasCritical ? 'REJECT' : anomalies.length > 0 ? 'FLAG_FOR_REVIEW' : 'ACCEPT'

  return {
    consistent: anomalies.length === 0,
    anomalies,
    recommendation,
  }
}
