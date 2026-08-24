import { eq, desc, sql } from 'drizzle-orm'
import type { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { getGpt4oMini } from '@/lib/azure-openai'
import { ORCHESTRATOR_PROMPT } from '@/lib/prompts/orchestrator'
import { getPromptVersion } from '@/lib/prompts/registry'
import { classifyAssistantOutput, ADVICE_DETECTED_REFUSAL } from '@/lib/safety/classifier'
import type { SupportedLanguage } from '@/lib/rag/explain-fund'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { getPortfolio } from '@/lib/tools/get-portfolio'
import { computePersonalInflationTool } from '@/lib/tools/compute-inflation'
import { computeRealReturns } from '@/lib/tools/compute-real-returns'
import { lookupChatHistory } from '@/lib/tools/lookup-chat-history'
import { explainFundTool } from '@/lib/tools/explain-fund'
import { explainStockTool } from '@/lib/tools/explain-stock'
import { compareFundsTool } from '@/lib/tools/compare-funds'
import { ToolArgSchemas } from '@/lib/tools/arg-schemas'
import type { Citation, RefusalReason } from '@/lib/contracts/refusal-types'
import type { OrchestratorAgentEvent, Evidence } from '@/lib/contracts/agent-events'
import { mapToolNameToAgentName } from '@/lib/agent-mapping'
import logger from '@/lib/logger'
import { randomUUID } from 'node:crypto'
import { startSpan, withCorrelation } from '@/lib/tracing'
import { emitChatLatencyMs, emitRefusal, emitTokensUsed } from '@/lib/metrics'

// ── config ────────────────────────────────────────────────────────────────────

const P95_LATENCY_BUDGET_MS = 12_000

export type OrchestratorConfig = {
  /** Maximum number of tool-call iterations allowed in a single turn. */
  maxToolIterations: number
  /** Maximum total tokens (prompt + completion) allowed in a single turn. */
  maxTokensPerTurn: number
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxToolIterations: 5,
  maxTokensPerTurn: 4_000,
}

// Blended USD cost per 1k tokens (input + output) for the default GPT-4o-mini
// orchestrator deployment. Override via TOKEN_COST_PER_1K_USD for other models/pricing.
const TOKEN_COST_PER_1K_USD = Number(process.env.TOKEN_COST_PER_1K_USD ?? 0.000375)

function estimateCostUsd(tokens: number): string {
  return (tokens * TOKEN_COST_PER_1K_USD / 1000).toFixed(8)
}

async function incrementUserCost(userId: string, tokens: number): Promise<void> {
  const costUsd = estimateCostUsd(tokens)
  try {
    await db
      .update(schema.users)
      .set({
        monthlyTokens: sql`${schema.users.monthlyTokens} + ${tokens}`,
        monthlyCost: sql`${schema.users.monthlyCost} + ${costUsd}::numeric`,
      })
      .where(eq(schema.users.id, userId))
  } catch (error) {
    logger.warn(
      withCorrelation({ userId, tokens, error: error instanceof Error ? error.message : String(error) }),
      'orchestrator: failed to increment user cost',
    )
  }
}

export class CostBudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly cumulativeTokens: number,
    public readonly maxTokens: number,
  ) {
    super(message)
    this.name = 'CostBudgetExceededError'
  }
}

// Module-level singletons — avoids creating a new HTTP agent on every chat turn
const _client = getGpt4oMini()
const _deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI!

// ── types ─────────────────────────────────────────────────────────────────────

export type ToolTrace = {
  tool: string
  args: unknown
  result: unknown
}

export type OrchestratorResult = {
  assistant_message: string
  tool_traces: ToolTrace[]
  citations: Citation[]
  model_version: string
  refusal_reason: RefusalReason | null
  request_id: string
}

export type OrchestratorOptions = {
  language?: SupportedLanguage
  onEvent?: (event: OrchestratorAgentEvent) => void
  config?: Partial<OrchestratorConfig>
}

// ── tool dispatcher ───────────────────────────────────────────────────────────

function detectHinglish(message: string): SupportedLanguage {
  // Devanagari ranges: excludes Sanskrit/Vedic marks, includes common Hindi/Nagari
  return /[\u0900-\u097F]/.test(message) ? 'hi-en' : 'en'
}

async function dispatchTool(
  toolName: string,
  args: Record<string, string>,
  userId: string,
  language: SupportedLanguage,
): Promise<unknown> {
  return startSpan(
    'orchestrator.tool_dispatch',
    async () => {
      // Args are validated by the call site (parsedArgs block) before reaching here.
      switch (toolName) {
        case 'get_portfolio':
          return getPortfolio(userId)
        case 'compute_personal_inflation':
          return computePersonalInflationTool(userId)
        case 'compute_real_returns':
          return computeRealReturns(args.scheme_code, userId)
        case 'lookup_chat_history':
          return lookupChatHistory(userId)
        case 'explain_fund':
          return explainFundTool(args.scheme_code, args.question, language)
        case 'explain_stock':
          return explainStockTool(args.isin, args.question, language)
        case 'compare_funds':
          return compareFundsTool((args as any).scheme_codes, args.question)
        default:
          logger.warn({ toolName }, 'orchestrator: unknown tool called')
          return { error: `Unknown tool: ${toolName}` }
      }
    },
    { attributes: { tool: toolName, user_id: userId, language } },
  )
}

function collectToolMetadata(
  result: unknown,
  opts: { citations: Citation[]; refusalReason: RefusalReason | null },
) {
  if (!result || typeof result !== 'object') return
  const r = result as { refused?: unknown; refusal_reason?: unknown; citations?: Citation[] }
  if (Array.isArray(r.citations)) {
    opts.citations.push(...r.citations)
  }
  if (r.refused === true && typeof r.refusal_reason === 'string') {
    opts.refusalReason = r.refusal_reason as RefusalReason
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export async function runOrchestrator(
  userId: string,
  message: string,
  language?: SupportedLanguage,
  config?: Partial<OrchestratorConfig>,
): Promise<OrchestratorResult> {
  return runOrchestratorWithOptions(userId, message, { language, config })
}

export async function runOrchestratorWithEvents(
  userId: string,
  message: string,
  language: SupportedLanguage | undefined,
  onEvent: (event: OrchestratorAgentEvent) => void,
  config?: Partial<OrchestratorConfig>,
): Promise<OrchestratorResult> {
  return runOrchestratorWithOptions(userId, message, { language, onEvent, config })
}

async function runOrchestratorWithOptions(
  userId: string,
  message: string,
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const requestId = randomUUID()
  return startSpan(
    'orchestrator.turn',
    async (span) => {
      span.setAttribute('request_id', requestId)
      span.setAttribute('user_id', userId)
      span.setAttribute('language', options.language ?? 'auto')
      try {
        const { result, cumulativeTokens } = await runOrchestratorTurn(userId, message, options, requestId)
        await incrementUserCost(userId, cumulativeTokens)
        return result
      } catch (error) {
        if (error instanceof CostBudgetExceededError) {
          await incrementUserCost(userId, error.cumulativeTokens)
        }
        throw error
      }
    },
    { requestId, attributes: { user_id: userId, language: options.language ?? 'auto' } },
  )
}

async function runOrchestratorTurn(
  userId: string,
  message: string,
  options: OrchestratorOptions,
  requestId: string,
): Promise<{ result: OrchestratorResult; cumulativeTokens: number }> {
  const { language, onEvent, config: userConfig } = options
  const config: OrchestratorConfig = {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    ...userConfig,
  }
  const emit = (event: OrchestratorAgentEvent) => onEvent?.(event)
  const startedAt = Date.now()

  // 1. Persist user message
  await db.insert(schema.chatMessages).values({ userId, role: 'user', content: message })

  // 2. Fetch last 10 messages for context (chronological order)
  const history = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.ts))
    .limit(10)

  const resolvedLanguage = language ?? detectHinglish(message)

  // 3. Build messages array (oldest first) — only user/assistant roles for context window
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: ORCHESTRATOR_PROMPT.text },
    ...history
      .reverse()
      .filter((h) => h.role === 'user' || h.role === 'assistant')
      .map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
  ]

  const traces: ToolTrace[] = []
  const citations: Citation[] = []
  let refusalReason: RefusalReason | null = null
  let cumulativeTokens = 0

  // 4. Tool-call loop with iteration cap
  for (let i = 0; i < config.maxToolIterations; i++) {
    const completion = await startSpan(
      'azure_openai.chat_completion',
      async (span) => {
        const response = await _client.chat.completions.create({
          model: _deployment,
          messages,
          tools: TOOL_DEFINITIONS,
          temperature: 0.3,
        })
        span.setAttribute('deployment', _deployment)
        span.setAttribute('iteration', i + 1)
        span.setAttribute('tokens_used', response.usage?.total_tokens ?? 0)
        return response
      },
      { attributes: { deployment: _deployment, iteration: i + 1 } },
    )

    const tokensThisCall = completion.usage?.total_tokens ?? 0
    cumulativeTokens += tokensThisCall
    if (cumulativeTokens > config.maxTokensPerTurn) {
      throw new CostBudgetExceededError(
        `Token budget exceeded: ${cumulativeTokens} > ${config.maxTokensPerTurn}`,
        cumulativeTokens,
        config.maxTokensPerTurn,
      )
    }

    const msg = completion.choices[0].message

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Final answer — classify, persist, and return
      const finalContent = msg.content ?? ''
      if (!finalContent.trim()) {
        logger.warn({ userId, iteration: i + 1 }, 'orchestrator: model returned empty content')
      }

      const safety = await classifyAssistantOutput(finalContent)
      let deliveredContent = finalContent
      let deliveredRefusalReason: RefusalReason | null = refusalReason
      let safetyScore = safety.score

      if (safety.label === 'advice') {
        deliveredContent = ADVICE_DETECTED_REFUSAL
        deliveredRefusalReason = 'advice_detected'
        logger.warn(
          { userId, requestId, score: safety.score, reasoning: safety.reasoning },
          'orchestrator: advice detected in final output; replacing with refusal',
        )
      }

      const [messageRow] = await db
        .insert(schema.chatMessages)
        .values({
          userId,
          role: 'assistant',
          content: deliveredContent,
          citations,
          modelVersion: _deployment,
          refusalReason: deliveredRefusalReason,
          requestId,
          promptVersion: getPromptVersion('orchestrator'),
          safetyScore,
        })
        .returning({ id: schema.chatMessages.id })

      if (safety.label === 'borderline' && messageRow) {
        try {
          await db.insert(schema.safetyReviewQueue).values({
            userId,
            messageId: messageRow.id,
            content: deliveredContent,
            label: safety.label,
            score: safety.score,
            reasoning: safety.reasoning,
          })
        } catch (queueErr) {
          logger.error(
            { userId, requestId, messageId: messageRow.id, error: queueErr },
            'orchestrator: failed to insert borderline safety review row',
          )
        }
      }

      const elapsed = Date.now() - startedAt
      if (elapsed > P95_LATENCY_BUDGET_MS) {
        logger.warn(
          { userId, elapsedMs: elapsed, budget: P95_LATENCY_BUDGET_MS },
          'Chat turn exceeded p95 budget',
        )
      }

      logger.info(
        withCorrelation({ userId, iterations: i + 1, elapsedMs: elapsed, toolsUsed: traces.map((t) => t.tool), safetyLabel: safety.label }, requestId),
        'orchestrator: turn complete',
      )

      emitChatLatencyMs(elapsed, { user_id: userId, refusal_reason: deliveredRefusalReason ?? 'none' })
      emitTokensUsed(cumulativeTokens, userId)
      if (deliveredRefusalReason) {
        emitRefusal({ user_id: userId, refusal_reason: deliveredRefusalReason })
      }

      return {
        result: {
          assistant_message: deliveredContent,
          tool_traces: traces,
          citations,
          model_version: _deployment,
          refusal_reason: deliveredRefusalReason,
          request_id: requestId,
        },
        cumulativeTokens,
      }
    }

    // Process tool calls
    // Push assistant turn (with tool_calls) once before processing results
    messages.push(msg as ChatCompletionAssistantMessageParam)

    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue

      let parsedArgs: Record<string, string> = {}
      try {
        const raw = JSON.parse(tc.function.arguments)
        const argSchema = ToolArgSchemas[tc.function.name as keyof typeof ToolArgSchemas]
        if (argSchema) {
          const validated = argSchema.safeParse(raw)
          if (validated.success) {
            parsedArgs = validated.data as Record<string, string>
          } else {
            logger.warn(
              { toolName: tc.function.name, issues: validated.error.issues },
              'orchestrator: tool arg validation failed — using empty args',
            )
          }
        } else {
          parsedArgs = raw as Record<string, string>
        }
      } catch {
        parsedArgs = {}
      }

      const agent = mapToolNameToAgentName(tc.function.name)
      emit({ type: 'AgentStarted', agent, timestamp: new Date() })
      emit({ type: 'ToolCalled', agent, tool: tc.function.name, args: parsedArgs, timestamp: new Date() })

      const result = await dispatchTool(tc.function.name, parsedArgs, userId, resolvedLanguage)

      traces.push({ tool: tc.function.name, args: parsedArgs, result })

      const success = !(
        result &&
        typeof result === 'object' &&
        'error' in result &&
        result.error !== undefined &&
        result.error !== null
      )
      emit({ type: 'ToolCompleted', agent, tool: tc.function.name, success, timestamp: new Date() })

      // Collect citations and refusal metadata from strict-RAG tools
      if (tc.function.name === 'explain_fund' || tc.function.name === 'explain_stock' || tc.function.name === 'compare_funds') {
        collectToolMetadata(result, { citations, refusalReason })
      }

      const finding = extractFinding(tc.function.name, result)
      if (finding) {
        emit({ type: 'FindingCreated', agent, finding: finding.finding, evidence: finding.evidence, timestamp: new Date() })
      }

      emit({ type: 'AgentCompleted', agent, timestamp: new Date() })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }
  }

  // Exceeded config.maxToolIterations — persist fallback so chat history stays coherent
  logger.warn({ userId, iterations: config.maxToolIterations }, 'Max tool iterations hit')
  const fallbackMessage = "I got stuck working through your question. Could you rephrase?"
  await db.insert(schema.chatMessages).values({
    userId,
    role: 'assistant',
    content: fallbackMessage,
    citations,
    modelVersion: _deployment,
    refusalReason: refusalReason ?? 'contract_violation',
    requestId,
    promptVersion: getPromptVersion('orchestrator'),
    safetyScore: 0,
  })
  emitChatLatencyMs(Date.now() - startedAt, { user_id: userId, refusal_reason: refusalReason ?? 'contract_violation' })
  emitTokensUsed(cumulativeTokens, userId)
  emitRefusal({ user_id: userId, refusal_reason: refusalReason ?? 'contract_violation' })
  return {
    result: {
      assistant_message: fallbackMessage,
      tool_traces: traces,
      citations,
      model_version: _deployment,
      refusal_reason: refusalReason ?? 'contract_violation',
      request_id: requestId,
    },
    cumulativeTokens,
  }
}

function extractFinding(toolName: string, result: unknown): { finding: string; evidence: Evidence[] } | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>

  switch (toolName) {
    case 'get_portfolio': {
      const holdings = Array.isArray(r.holdings) ? r.holdings : []
      const total = typeof r.total_value === 'number' ? r.total_value : 0
      return {
        finding: `Portfolio loaded with ${holdings.length} holding${holdings.length === 1 ? '' : 's'}`,
        evidence: [
          { label: 'Holdings', value: String(holdings.length) },
          { label: 'Total value', value: `₹${formatCompact(total)}` },
        ],
      }
    }
    case 'compute_personal_inflation': {
      const rate = typeof r.inflation_rate === 'number' ? r.inflation_rate : null
      const confidence = r.confidence ? String(r.confidence) : undefined
      return {
        finding: rate !== null ? `Personal inflation computed at ${rate}%` : 'Personal inflation computed',
        evidence: [
          ...(rate !== null ? [{ label: 'Personal inflation', value: `${rate}%` }] : []),
          ...(confidence ? [{ label: 'Confidence', value: confidence }] : []),
        ],
      }
    }
    case 'compute_real_returns': {
      const scheme = typeof r.scheme_name === 'string' ? r.scheme_name : undefined
      const coverage = typeof r.coverage_ratio === 'number' ? `${Math.round(r.coverage_ratio * 100)}%` : undefined
      return {
        finding: scheme ? `Real returns analysed for ${scheme}` : 'Real returns analysed',
        evidence: [
          ...(scheme ? [{ label: 'Scheme', value: scheme }] : []),
          ...(coverage ? [{ label: 'Coverage', value: coverage }] : []),
        ],
      }
    }
    case 'explain_fund': {
      const scheme = typeof r.scheme_name === 'string' ? r.scheme_name : undefined
      const answer = typeof r.answer === 'string' ? r.answer : undefined
      return {
        finding: scheme ? `Fund research complete for ${scheme}` : 'Fund research complete',
        evidence: [
          ...(scheme ? [{ label: 'Scheme', value: scheme }] : []),
          ...(answer ? [{ label: 'Answer', value: answer }] : []),
        ],
      }
    }
    case 'compare_funds': {
      const comparison = typeof r.comparison === 'string' ? r.comparison : undefined
      return {
        finding: comparison ?? 'Fund comparison complete',
        evidence: [
          ...(comparison ? [{ label: 'Comparison', value: comparison }] : []),
        ],
      }
    }
    case 'explain_stock': {
      const company = typeof r.company_name === 'string' ? r.company_name : undefined
      const answer = typeof r.answer === 'string' ? r.answer : undefined
      return {
        finding: company ? `Stock research complete for ${company}` : 'Stock research complete',
        evidence: [
          ...(company ? [{ label: 'Company', value: company }] : []),
          ...(answer ? [{ label: 'Answer', value: answer }] : []),
        ],
      }
    }
    case 'lookup_chat_history': {
      const count = Array.isArray(r.messages) ? r.messages.length : 0
      return {
        finding: `Recalled ${count} prior chat turn${count === 1 ? '' : 's'}`,
        evidence: [{ label: 'Turns recalled', value: String(count) }],
      }
    }
    default:
      return null
  }
}

function formatCompact(n: number): string {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}
