import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '@/lib/auth/dev-user'

export type ChatAuditChunkApiResponse =
    | { ok: true; data: { chunkText: string; schemeName: string; section: string; factsheetDate: string } }
    | { ok: false; error: { code: string; message: string; request_id: string } }

/**
 * GET /api/chat/audit/chunk
 *
 * Returns the text of a single factsheet chunk by ID. Used by the audit UI
 * when a user clicks a citation. Does not require the user to own the chunk.
 */
export async function GET(req: Request) {
    try {
        const { userId, isNew } = await resolveOrCreateUserId()

        if (!userId) {
            return NextResponse.json(
                err('UNAUTHORIZED', 'no session'),
                { status: 401 },
            ) as NextResponse<ChatAuditChunkApiResponse>
        }

        const url = new URL(req.url)
        const id = url.searchParams.get('id')

        if (!id) {
            return NextResponse.json(
                err('VALIDATION_ERROR', 'Missing chunk id'),
                { status: 422 },
            ) as NextResponse<ChatAuditChunkApiResponse>
        }

        const row = await db.query.factsheetChunks.findFirst({
            where: eq(schema.factsheetChunks.id, id),
        })

        if (!row) {
            return NextResponse.json(
                err('NOT_FOUND', 'Chunk not found'),
                { status: 404 },
            ) as NextResponse<ChatAuditChunkApiResponse>
        }

        const response = NextResponse.json(
            ok({
                chunkText: row.chunkText,
                schemeName: row.schemeName,
                section: row.section,
                factsheetDate: row.factsheetDate,
            }),
        ) as NextResponse<ChatAuditChunkApiResponse>
        if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
        return response
    } catch (e) {
        const message = e instanceof Error ? e.message : 'database error'
        return NextResponse.json(
            err('DB_ERROR', message),
            { status: 500 },
        ) as NextResponse<ChatAuditChunkApiResponse>
    }
}
