import { NextResponse } from 'next/server'
import { eq, desc, and, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'

export type SafetyAuditItem = {
  id: string
  user_id: string
  message_id: string
  content: string
  label: 'borderline' | 'advice'
  score: number
  reasoning: string | null
  reviewed: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type SafetyAuditApiResponse =
  | {
      ok: true
      data: {
        flags: SafetyAuditItem[]
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
 * GET /api/chat/audit/safety
 *
 * Returns safety-review queue entries for the authenticated user.
 * By default only unreviewed borderline/advice flags are returned.
 *
 * Query params:
 *   page     - 1-indexed page number (default 1)
 *   pageSize - items per page, max 100 (default 25)
 *   all      - if "true", include reviewed entries too
 *
 * TODO: Add admin role check to allow reviewing flags for any user.
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorizedResponse()
    const userId = user.userId

    const url = new URL(req.url)
    const rawPage = Number(url.searchParams.get('page') ?? '1')
    const rawPageSize = Number(url.searchParams.get('pageSize') ?? '25')
    const includeReviewed = url.searchParams.get('all') === 'true'

    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage
    const pageSize = Number.isNaN(rawPageSize) ? 25 : Math.min(Math.max(rawPageSize, 1), 100)

    const whereConditions = [eq(schema.safetyReviewQueue.userId, userId)]
    if (!includeReviewed) {
      whereConditions.push(
        and(
          eq(schema.safetyReviewQueue.reviewed, false),
          or(eq(schema.safetyReviewQueue.label, 'borderline'), eq(schema.safetyReviewQueue.label, 'advice')),
        ) as ReturnType<typeof and>,
      )
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.safetyReviewQueue)
      .where(and(...whereConditions))

    const rows = await db
      .select({
        id: schema.safetyReviewQueue.id,
        userId: schema.safetyReviewQueue.userId,
        messageId: schema.safetyReviewQueue.messageId,
        content: schema.safetyReviewQueue.content,
        label: schema.safetyReviewQueue.label,
        score: schema.safetyReviewQueue.score,
        reasoning: schema.safetyReviewQueue.reasoning,
        reviewed: schema.safetyReviewQueue.reviewed,
        reviewedBy: schema.safetyReviewQueue.reviewedBy,
        reviewedAt: schema.safetyReviewQueue.reviewedAt,
        createdAt: schema.safetyReviewQueue.createdAt,
      })
      .from(schema.safetyReviewQueue)
      .where(and(...whereConditions))
      .orderBy(desc(schema.safetyReviewQueue.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const flags: SafetyAuditItem[] = rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      message_id: r.messageId,
      content: r.content,
      label: r.label as 'borderline' | 'advice',
      score: r.score,
      reasoning: r.reasoning,
      reviewed: r.reviewed,
      reviewed_by: r.reviewedBy,
      reviewed_at: r.reviewedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
    }))

    return NextResponse.json(
      ok({
        flags,
        pagination: {
          page,
          pageSize,
          total: count,
          hasNext: page * pageSize < count,
        },
      }),
    ) as NextResponse<SafetyAuditApiResponse>
  } catch (e) {
    const message = e instanceof Error ? e.message : 'database error'
    return NextResponse.json(
      err('DB_ERROR', message),
      { status: 500 },
    ) as NextResponse<SafetyAuditApiResponse>
  }
}
