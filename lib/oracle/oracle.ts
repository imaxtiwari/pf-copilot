import { DeliberationMessage } from '../deliberation/message-schema'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { getGpt4oMini } from '../azure-openai'
import { HALLUCINATION_TRIPWIRES } from './tripwire-registry'
import { scoreConfidence } from './confidence-scorer'
import { MEMORY_TTL_DAYS } from '../memory/ttl-config'
import { validateCrossRunConsistency } from './cross-run-validator'
import logger from '../logger'

// ─── TTL Lookup Table: sender + message_type → TTL days ──────────────────────

const SENDER_TYPE_TTL: Record<string, number> = {
  'SOMA:FUND_REPORT': MEMORY_TTL_DAYS.SOMA_NAV_DATA,
  'SOMA:FUND_COMPOSITION': MEMORY_TTL_DAYS.SOMA_FUND_COMPOSITION,
  'KIRAN:RISK_ALERT': MEMORY_TTL_DAYS.KIRAN_MACRO_BULLETIN,
  'VIKRAM:STRATEGY_PROPOSAL': MEMORY_TTL_DAYS.VIKRAM_STRATEGY_FRAMEWORK,
  'VIKRAM:PORTFOLIO_DRAFT': MEMORY_TTL_DAYS.VIKRAM_CLIENT_GOAL_ASSESSMENT,
  'PRIYA:PORTFOLIO_DRAFT': MEMORY_TTL_DAYS.PRIYA_PORTFOLIO_DRAFT,
  'ARIA:CRITIQUE': MEMORY_TTL_DAYS.ARIA_CRITIQUE_REPORT,
  'DHRUV:VOTE': MEMORY_TTL_DAYS.DHRUV_COMMITTEE_VOTE,
  'DHRUV:DIRECTIVE': MEMORY_TTL_DAYS.DHRUV_FINAL_PORTFOLIO,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function approximateTokenCount(text: string): number {
  // ~4 chars per token is a good approximation for English/JSON text
  return Math.ceil(text.length / 4)
}

function extractAllStrings(obj: unknown, results: string[] = []): string[] {
  if (typeof obj === 'string') {
    results.push(obj)
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractAllStrings(item, results)
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj)) extractAllStrings(val, results)
  }
  return results
}

function findSourceUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = []

  // Common payload fields that may contain source URLs
  const candidates = [
    payload['source_url'],
    payload['evidence_sources'],
    payload['data_source'],
    payload['references'],
  ]

  for (const c of candidates) {
    if (typeof c === 'string') urls.push(c)
    if (Array.isArray(c)) urls.push(...c.filter((x): x is string => typeof x === 'string'))
  }

  return urls
}

/**
 * ORACLE Middleware — runs on EVERY deliberation message.
 * Never throws. Returns a (potentially flagged) message always.
 */
export async function oracleMiddleware(msg: DeliberationMessage): Promise<DeliberationMessage> {
  const flags: string[] = []
  let payloadStr = ''
  let sourceUrls: string[] = []

  try {
    payloadStr = JSON.stringify(msg.payload)
    sourceUrls = findSourceUrls(msg.payload)
    // ── CHECK 1: Source Presence ────────────────────────────────────────────
    // Detect factual claims: meaningful financial numbers (3+ digits), percentages, dates
    // 3+ digit threshold avoids flagging small operational numbers like deadline_minutes:30
    const hasNumericClaims = /\b\d{3,}(?:[.,]\d+)?\b/.test(payloadStr)
    const hasPercentages = /\b\d+(?:\.\d+)?\s*%/.test(payloadStr)
    const hasDates = /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/.test(payloadStr)

    const hasFactualClaims = hasNumericClaims || hasPercentages || hasDates

    if (hasFactualClaims && sourceUrls.length === 0 && msg.references.length === 0) {
      flags.push('SOURCE_MISSING — factual claims detected without source citation.')
    }

    // ── CHECK 2: Source Freshness ───────────────────────────────────────────
    const ttlKey = `${msg.sender}:${msg.message_type}`
    const ttlDays = SENDER_TYPE_TTL[ttlKey] ?? 30 // default 30 days if not mapped

    // Look for retrieved_at in payload (any depth)
    const allStrings = extractAllStrings(msg.payload)
    const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

    for (const str of allStrings) {
      if (isoTimestampPattern.test(str)) {
        const ageDays = (Date.now() - new Date(str).getTime()) / (1000 * 60 * 60 * 24)
        if (ageDays > ttlDays && ttlDays !== Infinity) {
          flags.push(
            `SOURCE_STALE — data retrieved ${Math.round(ageDays)} days ago, TTL=${ttlDays} days.`
          )
          break // one stale flag per message is enough
        }
      }
    }

    // ── CHECK 3: Internal Consistency (LLM) ────────────────────────────────
    if (approximateTokenCount(payloadStr) > 200) {
      try {
        const client = getGpt4oMini()
        const response = await client.chat.completions.create({
          model: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI!,
          temperature: 0,
          max_tokens: 300,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You are a financial data auditor. Check the following JSON for internal contradictions ' +
                '(e.g. total allocations not summing to 100%, dates in wrong order, NAV mismatches). ' +
                'Return JSON: {"contradictions": ["..."]}. Empty array if none. Be concise, max 3 items.'
            },
            {
              role: 'user',
              content: payloadStr.slice(0, 4000) // guard against very large payloads
            }
          ]
        })

        const raw = response.choices[0]?.message?.content ?? '{}'
        const parsed = JSON.parse(raw) as { contradictions?: string[] }

        if (Array.isArray(parsed.contradictions)) {
          for (const contradiction of parsed.contradictions) {
            if (contradiction && contradiction.trim()) {
              flags.push(`INTERNAL_CONTRADICTION — ${contradiction.trim()}`)
            }
          }
        }
      } catch (llmErr) {
        // LLM errors are non-fatal; log and skip
        logger.warn({ llmErr, message_id: msg.message_id }, 'ORACLE LLM consistency check failed — skipping')
      }
    }

    // ── CHECK 4: Hallucination Tripwires ────────────────────────────────────
    for (const tripwire of HALLUCINATION_TRIPWIRES) {
      if (tripwire.pattern.test(payloadStr)) {
        // Check if at least one required source is present in payload URLs
        const hasRequiredSource = sourceUrls.some(url =>
          tripwire.required_sources.some(domain => url.includes(domain))
        )

        if (!hasRequiredSource) {
          flags.push(
            `HALLUCINATION_RISK — ${tripwire.field_name} cited without approved source. ` +
            `Required: ${tripwire.required_sources.join(' or ')}.`
          )
        }
      }
    }

    // ── CHECK 5: Cross-Run Consistency Check ────────────────────────────────
    if (msg.sender === 'SOMA' && (msg.message_type === 'FUND_REPORT' || msg.message_type === 'FUND_COMPOSITION')) {
      const crossRunResult = await validateCrossRunConsistency('SOMA', msg)

      if (crossRunResult.recommendation === 'REJECT') {
        for (const anomaly of crossRunResult.anomalies) {
          auditTrail.log({
            pipeline_run_id: msg.pipeline_run_id,
            agent_id: 'ORACLE',
            action_type: AuditActionType.ORACLE_CROSS_RUN_ANOMALY,
            payload: {
              agentId: msg.sender,
              field: anomaly.field,
              delta: anomaly.delta,
              severity: anomaly.severity,
              actionTaken: 'rejected',
              schemeName: msg.payload?.scheme_name || msg.payload?.scheme_code || 'Unknown Fund',
              currentValue: anomaly.currentValue,
              previousValue: anomaly.previousValue
            }
          })
        }

        throw new Error(`ORACLE_REJECTED — message rejected due to critical cross-run consistency anomalies: ${JSON.stringify(crossRunResult.anomalies)}`)
      } else if (crossRunResult.recommendation === 'FLAG_FOR_REVIEW') {
        for (const anomaly of crossRunResult.anomalies) {
          auditTrail.log({
            pipeline_run_id: msg.pipeline_run_id,
            agent_id: 'ORACLE',
            action_type: AuditActionType.ORACLE_CROSS_RUN_ANOMALY,
            payload: {
              agentId: msg.sender,
              field: anomaly.field,
              delta: anomaly.delta,
              severity: anomaly.severity,
              actionTaken: 'flagged',
              schemeName: msg.payload?.scheme_name || msg.payload?.scheme_code || 'Unknown Fund',
              currentValue: anomaly.currentValue,
              previousValue: anomaly.previousValue
            }
          })

          flags.push(
            `CROSS_RUN_ANOMALY — ${anomaly.field} value of ${anomaly.currentValue} drifted from ${anomaly.previousValue} (previous run ${anomaly.previousRunId}).`
          )
        }
      }
    }

  } catch (internalErr) {
    // ── ORACLE INTERNAL ERROR guard ─────────────────────────────────────────
    logger.error({ internalErr, message_id: msg.message_id }, 'ORACLE internal error — setting PENDING')

    return {
      ...msg,
      oracle_validation: {
        status: 'PENDING',
        flags: ['ORACLE_INTERNAL_ERROR — manual review required']
      }
    }
  }

  // ── CHECK 5: Set Final Status ───────────────────────────────────────────────
  const status = flags.length === 0 ? 'PASSED' : 'FLAGGED'

  const claim = {
    content: payloadStr,
    source_url: sourceUrls[0],
    has_contradictions: flags.some(f => f.includes('CONTRADICTION'))
  }
  const tier = scoreConfidence(claim)
  const confidence_score = tier === 'VERIFIED' ? 100 : tier === 'INFERRED' ? 70 : 30

  // ── CHECK 6: Audit Trail ────────────────────────────────────────────────────
  auditTrail.log({
    pipeline_run_id: msg.pipeline_run_id,
    agent_id: 'ORACLE',
    action_type:
      status === 'FLAGGED'
        ? AuditActionType.ORACLE_FLAG_RAISED
        : AuditActionType.ORACLE_VALIDATION_PASSED,
    oracle_confidence: confidence_score,
    payload: {
      message_id: msg.message_id,
      sender: msg.sender,
      message_type: msg.message_type,
      oracle_status: status,
      flag_count: flags.length,
      flags
    }
  })

  if (status === 'FLAGGED') {
    logger.warn(
      { message_id: msg.message_id, sender: msg.sender, flags },
      'ORACLE flagged message'
    )
  }

  return {
    ...msg,
    oracle_validation: { status, flags, confidence_score }
  }
}
