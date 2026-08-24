import { NextRequest } from 'next/server'
import { z } from 'zod'
import { runOrchestratorWithEvents, CostBudgetExceededError } from '@/lib/orchestrator'
import { buildWorkspaceState } from '@/lib/agent-mapping'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import type { SupportedLanguage } from '@/lib/rag/explain-fund'
import type { OrchestratorAgentEvent, CopilotStatus, AgentEvent } from '@/lib/contracts/agent-events'
import logger from '@/lib/logger'
import { randomUUID } from 'node:crypto'
import { rateLimit, rateLimitSseResponse } from '@/lib/rate-limit'

export const maxDuration = 30

const ChatRequestSchema = z.object({
    message: z.string().min(1).max(2000),
    language: z.enum(['en', 'hi-en']).optional(),
})

function toSnakeEvent(event: OrchestratorAgentEvent): AgentEvent {
    const base = {
        id: randomUUID(),
        timestamp: event.timestamp,
        agent: event.agent,
    }

    switch (event.type) {
        case 'AgentStarted':
            return { ...base, type: 'agent_started', task: `${event.agent} started` }
        case 'ToolCalled':
            return { ...base, type: 'tool_called', tool: event.tool ?? '', args: event.args }
        case 'ToolCompleted':
            return {
                ...base,
                type: 'tool_completed',
                tool: event.tool ?? '',
                success: event.success ?? true,
                error: event.error,
            }
        case 'FindingCreated':
            return {
                ...base,
                type: 'finding_created',
                finding: event.finding ?? '',
                evidence: event.evidence ?? [],
            }
        case 'AgentCompleted':
            return { ...base, type: 'agent_completed', summary: `${event.agent} completed` }
        default:
            return { ...base, type: 'agent_completed', summary: `${event.agent} completed` }
    }
}

function deriveCopilotStatusFromEvent(event: OrchestratorAgentEvent): CopilotStatus {
    const agent = event.agent
    switch (event.type) {
        case 'AgentStarted':
        case 'ToolCalled': {
            if (agent === 'Fund Research Agent' || agent === 'Risk Analyst') return 'researching'
            if (agent === 'Performance Analyst' || agent === 'Inflation Analyst') return 'analysing'
            return 'analysing'
        }
        case 'ToolCompleted': {
            if (!event.success) return 'cross-checking'
            return 'synthesizing'
        }
        case 'AgentCompleted':
            return 'synthesizing'
        case 'FindingCreated':
            return agent === 'Fund Research Agent' || agent === 'Risk Analyst' ? 'researching' : 'analysing'
        default:
            return 'analysing'
    }
}

function sseLine(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser()
    if (!user) return unauthorizedResponse()
    const userId = user.userId

    // Per-user rate limit: 20 chat messages per minute.
    const userLimit = await rateLimit(req, { key: 'chat:user', limit: 20, window: 60, identifier: `user:${userId}` })
    if (!userLimit.success) {
        return rateLimitSseResponse(userLimit)
    }

    // Per-IP rate limit: 60 chat messages per minute.
    const ipLimit = await rateLimit(req, { key: 'chat:ip', limit: 60, window: 60 })
    if (!ipLimit.success) {
        return rateLimitSseResponse(ipLimit)
    }

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return new Response(
            sseLine('error', { code: 'INVALID_JSON', message: 'Request body must be valid JSON' }),
            { status: 400, headers: { 'Content-Type': 'text/event-stream' } },
        )
    }

    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
        return new Response(
            sseLine('error', {
                code: 'VALIDATION_ERROR',
                message: 'Invalid request',
                details: parsed.error.flatten(),
            }),
            { status: 422, headers: { 'Content-Type': 'text/event-stream' } },
        )
    }

    const { message, language } = parsed.data
    logger.info({ userId, messageLength: message.length, language }, 'chat/stream: incoming message')

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder()
            const send = (event: string, data: unknown) => {
                controller.enqueue(encoder.encode(sseLine(event, data)))
            }

            try {
                const result = await runOrchestratorWithEvents(
                    userId,
                    message,
                    language as SupportedLanguage | undefined,
                    (event) => {
                        send('agent', toSnakeEvent(event))
                        send('copilot_status', {
                            id: randomUUID(),
                            timestamp: new Date().toISOString(),
                            status: deriveCopilotStatusFromEvent(event),
                        })
                    },
                )

                const workspaceState = buildWorkspaceState(
                    result.tool_traces,
                    result.assistant_message,
                    true,
                )

                send('assistant', {
                    assistant_message: result.assistant_message,
                    tool_traces: result.tool_traces,
                    citations: result.citations,
                    model_version: result.model_version,
                    refusal_reason: result.refusal_reason,
                    request_id: result.request_id,
                    workspace_state: workspaceState,
                    timestamp: new Date().toISOString(),
                })

                // Safety incidents are persisted by the orchestrator; the stream route
                // only surfaces the final safety state to the client for transparency.
                if (result.refusal_reason === 'advice_detected') {
                    send('safety', {
                        label: 'advice',
                        message: 'This response was replaced because it contained investment advice.',
                        request_id: result.request_id,
                        timestamp: new Date().toISOString(),
                    })
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                const requestId = randomUUID()

                if (e instanceof CostBudgetExceededError) {
                    logger.warn(
                        { userId, requestId, cumulativeTokens: e.cumulativeTokens, maxTokens: e.maxTokens },
                        'chat/stream: cost budget exceeded',
                    )
                    try {
                        await db.insert(schema.chatMessages).values({
                            userId,
                            role: 'assistant',
                            content: `This request exceeded the per-turn token budget (${e.maxTokens}). Please simplify your question and try again.`,
                            refusalReason: 'cost_budget_exceeded',
                            requestId,
                        })
                    } catch (dbErr) {
                        logger.error({ userId, requestId, error: dbErr }, 'chat/stream: failed to persist cost budget audit row')
                    }
                    send('error', {
                        code: 'cost_budget_exceeded',
                        message: 'This request exceeded the per-turn token budget. Please simplify your question and try again.',
                        details: { max_tokens: e.maxTokens, cumulative_tokens: e.cumulativeTokens },
                        request_id: requestId,
                    })
                } else {
                    logger.error({ userId, requestId, error: msg }, 'chat/stream: orchestrator threw')
                    send('error', { code: 'ORCHESTRATOR_ERROR', message: 'An unexpected error occurred. Please try again.', request_id: requestId })
                }
            } finally {
                controller.close()
            }
        },
    })

    const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
    })

    return new Response(stream, { headers })
}
