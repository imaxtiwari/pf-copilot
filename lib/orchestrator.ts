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
import { ARG_SCHEMAS } from '@/lib/tools/arg-schemas'
import type { Citation } from '@/lib/contracts/refusal-types'
import logger from '@/lib/logger'

// ── config ────────────────────────────────────────────────────────────────────

const P95_LATENCY_BUDGET_MS = 12_000
const MAX_TOOL_ITERATIONS = 5

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
}

// ── tool dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(
  toolName: string,
  rawArgs: Record<string, string>,
  userId: string,
): Promise<unknown> {
  // Validate LLM-supplied args against the Zod schema for tools that have one.
  // Tools with no parameters skip validation (schema not present in ARG_SCHEMAS).
  const schema = ARG_SCHEMAS[toolName]
  let args = rawArgs
  if (schema) {
    const result = schema.safeParse(rawArgs)
    if (!result.success) {
      logger.warn({ toolName, errors: result.error.issues, rawArgs }, 'orchestrator: tool arg validation failed')
      return { error: `Invalid arguments for ${toolName}: ${result.error.issues.map((i) => i.message).join(', ')}` }
    }
    args = result.data as Record<string, string>
  }

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
    default:
      logger.warn({ toolName }, 'orchestrator: unknown tool called')
      return { error: `Unknown tool: ${toolName}` }
  }
}

// ── main export ───────────────────────────────────────────────────────────────

export async function runOrchestrator(
  userId: string,
  message: string,
): Promise<OrchestratorResult> {
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

  // 4. Tool-call loop with iteration cap
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await _client.chat.completions.create({
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
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, string>
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
