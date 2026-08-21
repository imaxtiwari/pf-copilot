import { eq, desc, and, ne, inArray } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { DeliberationMessage } from '../deliberation/message-schema'
import logger from '../logger'

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
// Key: currentPipelineRunId
// Value: { previousMessages: any[], timestamp: number }
const previousMessagesCache = new Map<string, { previousMessages: any[]; timestamp: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour TTL

const MAX_DRIFT: Record<string, number> = {
  fund_1yr_return: 15,
  fund_3yr_return: 5,
  fund_5yr_return: 5,
  expense_ratio: 0.5,
  aum: 0.30, // 30% relative drift
  sharpe_ratio: 0.5,
  sortino_ratio: 0.5,
}

function extractMetrics(payload: any) {
  const keyMetrics = payload?.key_metrics || {}
  
  // Extract returns
  const returns = keyMetrics.returns || payload?.returns || {}
  const return_1yr = returns['1y'] ?? returns['1yr'] ?? payload?.return_1y ?? payload?.return_1yr
  const return_3yr = returns['3y'] ?? returns['3yr'] ?? payload?.return_3y ?? payload?.return_3yr
  const return_5yr = returns['5y'] ?? returns['5yr'] ?? payload?.return_5y ?? payload?.return_5yr
  
  // Extract expense ratio
  const expense_ratio = keyMetrics.expense_ratio ?? payload?.expense_ratio
  
  // Extract AUM
  const aum = keyMetrics.aum_cr ?? keyMetrics.aum ?? payload?.aum_cr ?? payload?.aum
  
  // Extract Sharpe
  const sharpe = keyMetrics.sharpe_3y ?? keyMetrics.sharpe ?? payload?.sharpe_3y ?? payload?.sharpe
  
  // Extract Sortino
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

export async function validateCrossRunConsistency(
  agentId: string,
  currentMessage: DeliberationMessage,
  lookbackRuns: number = 5
): Promise<CrossRunValidationResult> {
  const currentRunId = currentMessage.pipeline_run_id
  const schemeCode = currentMessage.payload?.scheme_code as string | undefined

  if (!schemeCode) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  // 1. Check cache for previous deliberation messages associated with the current pipeline run
  const now = Date.now()
  const cached = previousMessagesCache.get(currentRunId)
  let prevMessages: any[] = []

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    prevMessages = cached.previousMessages
  } else {
    try {
      // Fetch the clientId for this pipeline run
      const [run] = await db
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.runId, currentRunId))
        .limit(1)

      if (run && run.clientId) {
        const clientId = run.clientId

        // Fetch the last N pipeline runs for this user (excluding current run)
        const previousRunsList = await db
          .select({ runId: schema.pipelineRuns.runId })
          .from(schema.pipelineRuns)
          .where(
            and(
              eq(schema.pipelineRuns.clientId, clientId),
              ne(schema.pipelineRuns.runId, currentRunId)
            )
          )
          .orderBy(desc(schema.pipelineRuns.startedAt))
          .limit(lookbackRuns)

        if (previousRunsList.length > 0) {
          const runIds = previousRunsList.map(r => r.runId)

          // Fetch all deliberation messages from SOMA in those runs
          const dbMessages = await db
            .select()
            .from(schema.deliberationMessages)
            .where(
              and(
                inArray(schema.deliberationMessages.pipelineRunId, runIds),
                eq(schema.deliberationMessages.sender, agentId)
              )
            )

          prevMessages = dbMessages
        }
      }

      // Populate cache
      previousMessagesCache.set(currentRunId, {
        previousMessages: prevMessages,
        timestamp: now
      })
    } catch (err) {
      logger.error({ err, currentRunId }, 'Oracle CrossRunValidator: Failed to fetch previous runs or messages from DB')
      // Fall back to consistent if DB errors occur to avoid locking the pipeline
      return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
    }
  }

  // If no previous messages found, we skip check and accept
  if (prevMessages.length === 0) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  // Filter messages for the same message_type and scheme_code
  const matchingMessages = prevMessages.filter((m: any) => {
    return m.messageType === currentMessage.message_type && m.payload?.scheme_code === schemeCode
  })

  if (matchingMessages.length === 0) {
    return { consistent: true, anomalies: [], recommendation: 'ACCEPT' }
  }

  // Sort matching messages by timestamp descending to find the most recent one
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
        // Determine severity: CRITICAL if delta > 2x threshold
        const severity = Math.abs(delta) > 2 * threshold ? 'CRITICAL' : 'WARN'

        anomalies.push({
          field,
          previousValue: prevVal,
          currentValue: currentVal,
          delta,
          previousRunId: prevMsg.pipelineRunId,
          severity
        })
      }
    }
  }

  const hasCritical = anomalies.some(a => a.severity === 'CRITICAL')
  const recommendation = hasCritical ? 'REJECT' : (anomalies.length > 0 ? 'FLAG_FOR_REVIEW' : 'ACCEPT')

  return {
    consistent: anomalies.length === 0,
    anomalies,
    recommendation
  }
}
