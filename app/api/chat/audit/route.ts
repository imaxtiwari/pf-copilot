import { NextResponse } from 'next/server'
import { eq, desc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'

export type AuditMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    ts: string
    citations: Array<{
        chunk_id: string
        factsheet_date: string
        section: string
    }>
    model_version: string | null
    refusal_reason: string | null
    request_id: string | null
}

export type ChatAuditApiResponse =
    | {
        ok: true
        data: {
            messages: AuditMessage[]
            pagination: {
                page: number
                pageSize: number
                total: number
                hasNext: boolean
            }
        }
    }
    | { ok: false; error: { code: string; message: string; request_id: string } }

/**
 * GET /api/chat/audit
 *
 * Returns the authenticated user's chat history with full audit metadata.
 * Query params:
 *   page     - 1-indexed page number (default 1)
 *   pageSize - items per page, max 100 (default 25)
 */
export async function GET(req: Request) {
    try {
        const user = await getCurrentUser()
        if (!user) return unauthorizedResponse()
        const userId = user.userId

        const url = new URL(req.url)
        const rawPage = Number(url.searchParams.get('page') ?? '1')
        const rawPageSize = Number(url.searchParams.get('pageSize') ?? '25')

        const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage
        const pageSize = Number.isNaN(rawPageSize) ? 25 : Math.min(Math.max(rawPageSize, 1), 100)

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.chatMessages)
            .where(eq(schema.chatMessages.userId, userId))

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
            .limit(pageSize)
            .offset((page - 1) * pageSize)

        const messages = rows
            .reverse()
            .map((r) => ({
                id: r.id,
                role: r.role as 'user' | 'assistant',
                content: r.content,
                ts: r.ts.toISOString(),
                citations: (r.citations ?? []) as Array<{
                    chunk_id: string
                    factsheet_date: string
                    section: string
                }>,
                model_version: r.modelVersion ?? null,
                refusal_reason: r.refusalReason ?? null,
                request_id: r.requestId ?? null,
            }))

        const response = NextResponse.json(
            ok({
                messages,
                pagination: {
                    page,
                    pageSize,
                    total: count,
                    hasNext: page * pageSize < count,
                },
            }),
        ) as NextResponse<ChatAuditApiResponse>
        return response
    } catch (e) {
        const message = e instanceof Error ? e.message : 'database error'
        return NextResponse.json(
            err('DB_ERROR', message),
            { status: 500 },
        ) as NextResponse<ChatAuditApiResponse>
    }
}
