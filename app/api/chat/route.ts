import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '@/lib/auth/dev-user'
import { runOrchestrator } from '@/lib/orchestrator'
import logger from '@/lib/logger'

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
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.ts))
    .limit(50)

  const messages = rows
    .filter((r: any) => r.role === 'user' || r.role === 'assistant')
    .reverse()
    .map((r: any) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      ts: r.ts.toISOString(),
    }))

  const response = NextResponse.json(ok({ messages }))
  if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
  return response
}

// ── POST /api/chat — send a message, run orchestrator ─────────────────────────

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
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

  const { message } = parsed.data
  logger.info({ userId, messageLength: message.length }, 'chat: incoming message')

  try {
    const result = await runOrchestrator(userId, message)
    const response = NextResponse.json(
      ok({
        assistant_message: result.assistant_message,
        tool_traces: result.tool_traces,
        citations: result.citations,
      }),
      { status: 200 },
    )
    if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
    return response
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error({ userId, error: msg }, 'chat: orchestrator threw')
    return NextResponse.json(
      err('ORCHESTRATOR_ERROR', 'An unexpected error occurred. Please try again.'),
      { status: 500 },
    )
  }
}
