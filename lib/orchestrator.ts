import { eq, desc } from 'drizzle-orm'
import type { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { getGpt4oMini } from '@/lib/azure-openai'
import { ORCHESTRATOR_PROMPT } from '@/lib/prompts/orchestrator'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { getPortfolio } from '@/lib/tools/get-portfolio'
import { computePersonalInflationTool } from '@/lib/tools/compute-inflation'
import { computeRealReturns } from '@/lib/tools/compute-real-returns'
import { lookupChatHistory } from '@/lib/tools/lookup-chat-history'
import { explainFundTool } from '@/lib/tools/explain-fund'
import { getRecommendationPacket } from '@/lib/tools/get-recommendation-packet'
import { getSipStatus } from '@/lib/tools/get-sip-status'
import { ToolArgSchemas } from '@/lib/tools/arg-schemas'
import type { Citation } from '@/lib/contracts/refusal-types'
import logger from '@/lib/logger'

// ── config ────────────────────────────────────────────────────────────────────

const P95_LATENCY_BUDGET_MS = 12_000
const MAX_TOOL_ITERATIONS = 5

// Module-level singletons — avoids creating a new HTTP agent on every chat turn
let _client: any = null
function getClient() {
  if (!_client) _client = getGpt4oMini()
  return _client
}
const _deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI || 'gpt-4o-mini'

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
}

// ── tool dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(
  toolName: string,
  args: Record<string, string>,
  userId: string,
): Promise<unknown> {
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
      return explainFundTool(args.scheme_code, args.question)
    case 'get_recommendation_packet':
      return getRecommendationPacket(userId)
    case 'get_sip_status':
      return getSipStatus(userId)
    default:
      logger.warn({ toolName }, 'orchestrator: unknown tool called')
      return { error: `Unknown tool: ${toolName}` }
  }
}

// ── context window ──────────────────────────────────────────────────────────────

export function buildContextWindow(messages: { role: string; content: string }[]): { role: string; content: string }[] {
  const TOKEN_BUDGET = 3000
  const estimateTokens = (m: { role: string; content: string }): number => Math.ceil(m.content.length / 4)

  const result: { role: string; content: string }[] = []
  let tokens = 0

  // DB returns descending (newest first). Iterate over newest first.
  for (const msg of messages) {
    const t = estimateTokens(msg)
    if (tokens + t > TOKEN_BUDGET && result.length > 0) break
    // unshift puts oldest at the start of the array
    result.unshift(msg)
    tokens += t
  }

  return result
}

// ── main export ───────────────────────────────────────────────────────────────

export async function runOrchestrator(
  userId: string,
  message: string,
): Promise<OrchestratorResult> {
  const startedAt = Date.now()

  // 1. Persist user message
  await db.insert(schema.chatMessages).values({ userId, role: 'user', content: message })

  // 2. Fetch last 30 messages for context pool (chronological order)
  const rawHistory = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.ts))
    .limit(30)

  // 3. Build messages array (oldest first) — only user/assistant roles for context window
  const filteredHistory = rawHistory.filter((h: any) => h.role === 'user' || h.role === 'assistant')
  const contextWindow = buildContextWindow(filteredHistory)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: ORCHESTRATOR_PROMPT.text },
    ...contextWindow.map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))
  ]

  const traces: ToolTrace[] = []
  const citations: Citation[] = []

  // 4. Tool-call loop with iteration cap
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await getClient().chat.completions.create({
      model: _deployment,
      messages,
      tools: TOOL_DEFINITIONS,
      temperature: 0.3,
    })

    const msg = completion.choices[0].message

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Final answer — persist and return
      const finalContent = msg.content ?? ''
      if (!finalContent.trim()) {
        logger.warn({ userId, iteration: i + 1 }, 'orchestrator: model returned empty content')
      }
      await db.insert(schema.chatMessages).values({
        userId,
        role: 'assistant',
        content: finalContent,
      })

      const elapsed = Date.now() - startedAt
      if (elapsed > P95_LATENCY_BUDGET_MS) {
        logger.warn(
          { userId, elapsedMs: elapsed, budget: P95_LATENCY_BUDGET_MS },
          'Chat turn exceeded p95 budget',
        )
      }

      logger.info(
        { userId, iterations: i + 1, elapsedMs: elapsed, toolsUsed: traces.map((t) => t.tool) },
        'orchestrator: turn complete',
      )

      return { assistant_message: finalContent, tool_traces: traces, citations }
    }

    // Process tool calls
    // Push assistant turn (with tool_calls) once before processing results
    messages.push(msg as ChatCompletionAssistantMessageParam)

    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue

      let parsedArgs: Record<string, string> = {}
      try {
        const raw = JSON.parse(tc.function.arguments)
        const schema = ToolArgSchemas[tc.function.name as keyof typeof ToolArgSchemas]
        if (schema) {
          const validated = schema.safeParse(raw)
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

      const result = await dispatchTool(tc.function.name, parsedArgs, userId)

      traces.push({ tool: tc.function.name, args: parsedArgs, result })

      // Collect citations from explain_fund results
      if (
        tc.function.name === 'explain_fund' &&
        result &&
        typeof result === 'object' &&
        'citations' in result &&
        Array.isArray((result as { citations: Citation[] }).citations)
      ) {
        citations.push(...(result as { citations: Citation[] }).citations)
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }
  }

  // Exceeded MAX_TOOL_ITERATIONS — persist fallback so chat history stays coherent
  logger.warn({ userId, iterations: MAX_TOOL_ITERATIONS }, 'Max tool iterations hit')
  const fallbackMessage = "I got stuck working through your question. Could you rephrase?"
  await db.insert(schema.chatMessages).values({
    userId,
    role: 'assistant',
    content: fallbackMessage,
  })
  return {
    assistant_message: fallbackMessage,
    tool_traces: traces,
    citations,
  }
}
