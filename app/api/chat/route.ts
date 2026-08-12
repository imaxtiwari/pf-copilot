import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '@/lib/auth/dev-user'
import { runOrchestrator } from '@/lib/orchestrator'
import { buildWorkspaceState } from '@/lib/agent-mapping'
import type { SupportedLanguage } from '@/lib/rag/explain-fund'
import logger from '@/lib/logger'
import { randomUUID } from 'node:crypto'

// ── Next.js timeout hint (respected by Vercel; no-op on localhost) ─────────────
export const maxDuration = 30

// ── GET /api/chat — return recent message history ─────────────────────────────

export async function GET() {
  const { userId, isNew } = await resolveOrCreateUserId()

  const rows = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      ts: schema.chatMessages.ts,
      citations: schema.chatMessages.citations,
      modelVersion: schema.chatMessages.modelVersion,
      refusalReason: schema.chatMessages.refusalReason,
      requestId: schema.chatMessages.requestId,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.ts))
    .limit(50)

  const messages = rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .reverse()
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      ts: r.ts.toISOString(),
      citations: (r.citations ?? []) as Array<{ chunk_id: string; factsheet_date: string; section: string }>,
      model_version: r.modelVersion,
      refusal_reason: r.refusalReason,
      request_id: r.requestId,
    }))

  const response = NextResponse.json(ok({ messages }))
  if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
  return response
}

// ── POST /api/chat — send a message, run orchestrator ─────────────────────────

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  language: z.enum(['en', 'hi-en']).optional(),
})

export async function POST(req: NextRequest) {
  const { userId, isNew } = await resolveOrCreateUserId()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(err('INVALID_JSON', 'Request body must be valid JSON'), { status: 400 })
  }

  const parsed = ChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      err('VALIDATION_ERROR', 'Invalid request', parsed.error.flatten()),
      { status: 422 },
    )
  }

  const { message, language } = parsed.data
  logger.info({ userId, messageLength: message.length, language }, 'chat: incoming message')

  try {
    const result = await runOrchestrator(userId, message, language as SupportedLanguage | undefined)
    const workspaceState = buildWorkspaceState(
      result.tool_traces,
      result.assistant_message,
      true,
    )
    const response = NextResponse.json(
      ok({
        assistant_message: result.assistant_message,
        tool_traces: result.tool_traces,
        citations: result.citations,
        model_version: result.model_version,
        refusal_reason: result.refusal_reason,
        request_id: result.request_id,
        workspace_state: workspaceState,
      }),
      { status: 200 },
    )
    if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
    return response
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const requestId = randomUUID()
    logger.error({ userId, requestId, error: msg }, 'chat: orchestrator threw')

    // Persist a traceable error response so the audit log shows the failure.
    try {
      await db.insert(schema.chatMessages).values({
        userId,
        role: 'assistant',
        content: `An unexpected error occurred. Reference: ${requestId}`,
        refusalReason: 'contract_violation',
        requestId,
      })
    } catch (dbErr) {
      logger.error({ userId, requestId, error: dbErr }, 'chat: failed to persist error audit row')
    }

    return NextResponse.json(
      err('ORCHESTRATOR_ERROR', 'An unexpected error occurred. Please try again.', undefined, requestId),
      { status: 500 },
    )
  }
}
