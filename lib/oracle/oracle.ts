import { DeliberationMessage } from '@/lib/deliberation/message-schema'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import { getGpt4oMini } from '@/lib/azure-openai'
import { HALLUCINATION_TRIPWIRES } from './tripwire-registry'
import { scoreConfidence } from './confidence-scorer'
import { MEMORY_TTL_DAYS } from '@/lib/memory/ttl-config'
import { validateCrossRunConsistency } from './cross-run-validator'
import logger from '@/lib/logger'

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

function approximateTokenCount(text: string): number {
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
  const candidates = [payload['source_url'], payload['evidence_sources'], payload['data_source'], payload['references']]

  for (const c of candidates) {
    if (typeof c === 'string') urls.push(c)
    if (Array.isArray(c)) urls.push(...c.filter((x): x is string => typeof x === 'string'))
  }

  return urls
}

function isDisclaimerRelated(msg: DeliberationMessage): boolean {
  const content = (msg.content || '').toLowerCase()
  return content.includes('disclaimer') || content.includes('not investment advice') || content.includes('educational')
}

/**
 * ORACLE Middleware — runs on EVERY deliberation message.
 * ORACLE can FLAG messages but cannot permanently block them.
 * It must never suppress disclaimers.
 */
export async function oracleMiddleware(
  dbClient: any,
  msg: DeliberationMessage,
): Promise<DeliberationMessage> {
  const flags: string[] = []
  let payloadStr = ''
  let sourceUrls: string[] = []

  try {
    payloadStr = JSON.stringify(msg.payload)
    sourceUrls = findSourceUrls(msg.payload)

    // ── CHECK 1: Source Presence ────────────────────────────────────────────
    const hasNumericClaims = /\b\d{3,}(?:[.,]\d+)?\b/.test(payloadStr)
    const hasPercentages = /\b\d+(?:\.\d+)?\s*%/.test(payloadStr)
    const hasDates = /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/.test(payloadStr)
    const hasFactualClaims = hasNumericClaims || hasPercentages || hasDates

    if (hasFactualClaims && sourceUrls.length === 0 && msg.references.length === 0 && !isDisclaimerRelated(msg)) {
      flags.push('SOURCE_MISSING — factual claims detected without source citation.')
    }

    // ── CHECK 2: Hallucination Tripwires ────────────────────────────────────
    const allStrings = extractAllStrings(msg.payload).join(' ')
    for (const tripwire of HALLUCINATION_TRIPWIRES) {
      if (tripwire.pattern.test(allStrings)) {
        const hasRequiredSource = sourceUrls.some((url) =>
          tripwire.required_sources.some((required) => url.includes(required)),
        )
        if (!hasRequiredSource) {
          flags.push(`HALLUCINATION_RISK — ${tripwire.description}`)
        }
      }
    }

    // ── CHECK 3: Token Bomb / Prompt Injection Size Guard ───────────────────
    const tokenEstimate = approximateTokenCount(payloadStr)
    if (tokenEstimate > 8000) {
      flags.push('PAYLOAD_SIZE_WARNING — payload exceeds 8,000-token heuristic threshold.')
    }

    // ── CHECK 4: Internal Contradictions (LLM-based, lightweight) ───────────
    if (hasFactualClaims && sourceUrls.length > 0) {
      try {
        const gpt = getGpt4oMini()
        const contradictionResponse = await gpt.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a contradiction checker. Given a payload, return JSON {contradictions: string[]}. List only clear internal contradictions.',
            },
            {
              role: 'user',
              content: `Payload:\n${payloadStr}\n\nReturn JSON only.`,
            },
          ],
          temperature: 0,
        })

        const raw = contradictionResponse.choices[0]?.message?.content?.trim() || '{"contradictions":[]}'
        const parsed = JSON.parse(raw.replace(/^```json/, '').replace(/```$/, '').trim())
        const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : []
        for (const c of contradictions) {
          flags.push(`CONTRADICTION — ${c}`)
        }
      } catch (llmErr) {
        logger.warn({ llmErr, message_id: msg.message_id }, 'ORACLE: contradiction check failed')
      }
    }

    // ── CHECK 5: Cross-run consistency ──────────────────────────────────────
    if (msg.payload?.scheme_code && dbClient) {
      try {
        const crossRunResult = await validateCrossRunConsistency(dbClient, msg.sender, msg, 5)

        if (crossRunResult.recommendation === 'REJECT') {
          for (const anomaly of crossRunResult.anomalies) {
            auditTrail.log({
              pipeline_run_id: msg.pipeline_run_id,
              user_id: '00000000-0000-0000-0000-000000000000',
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
                previousValue: anomaly.previousValue,
              },
            })

            flags.push(
              `CROSS_RUN_ANOMALY — ${anomaly.field} value of ${anomaly.currentValue} drifted from ${anomaly.previousValue} (previous run ${anomaly.previousRunId}).`,
            )
          }
        } else if (crossRunResult.recommendation === 'FLAG_FOR_REVIEW') {
          for (const anomaly of crossRunResult.anomalies) {
            auditTrail.log({
              pipeline_run_id: msg.pipeline_run_id,
              user_id: '00000000-0000-0000-0000-000000000000',
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
                previousValue: anomaly.previousValue,
              },
            })

            flags.push(
              `CROSS_RUN_ANOMALY — ${anomaly.field} value of ${anomaly.currentValue} drifted from ${anomaly.previousValue} (previous run ${anomaly.previousRunId}).`,
            )
          }
        }
      } catch (crossRunErr) {
        logger.warn({ crossRunErr, message_id: msg.message_id }, 'ORACLE: cross-run validation failed')
      }
    }
  } catch (internalErr) {
    logger.error({ internalErr, message_id: msg.message_id }, 'ORACLE internal error — setting PENDING')

    return {
      ...msg,
      oracle_validation: {
        status: 'PENDING',
        flags: ['ORACLE_INTERNAL_ERROR — manual review required'],
      },
    }
  }

  // ── CHECK 6: Set Final Status ───────────────────────────────────────────────
  const status = flags.length === 0 ? 'PASSED' : 'FLAGGED'

  const claim = {
    content: payloadStr,
    source_url: sourceUrls[0],
    has_contradictions: flags.some((f) => f.includes('CONTRADICTION')),
  }
  const tier = scoreConfidence(claim)
  const confidence_score = tier === 'VERIFIED' ? 100 : tier === 'INFERRED' ? 70 : 30

  auditTrail.log({
    pipeline_run_id: msg.pipeline_run_id,
    user_id: '00000000-0000-0000-0000-000000000000',
    agent_id: 'ORACLE',
    action_type: status === 'FLAGGED' ? AuditActionType.ORACLE_FLAG_RAISED : AuditActionType.ORACLE_VALIDATION_PASSED,
    oracle_confidence: confidence_score,
    payload: {
      message_id: msg.message_id,
      sender: msg.sender,
      message_type: msg.message_type,
      oracle_status: status,
      flag_count: flags.length,
      flags,
    },
  })

  if (status === 'FLAGGED') {
    logger.warn({ message_id: msg.message_id, sender: msg.sender, flags }, 'ORACLE flagged message')
  }

  return {
    ...msg,
    oracle_validation: { status, flags, confidence_score },
  }
}
