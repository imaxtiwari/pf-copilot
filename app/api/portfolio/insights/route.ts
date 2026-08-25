import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'
import { generateInsight, persistInsight, getLatestInsight } from '@/lib/portfolio/insights'

export type InsightsApiResponse =
    | { ok: true; insight: Awaited<ReturnType<typeof getLatestInsight>> }
    | { ok: false; error: { code: string; message: string } }

/**
 * GET /api/portfolio/insights
 *
 * Returns the latest persisted insight for the current user.
 * If no insight exists yet (e.g. stale session), generates one
 * on demand and persists it before responding.
 */
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user) return unauthorizedResponse() as NextResponse<InsightsApiResponse>
        const userId = user.userId

        let insight = await getLatestInsight(userId)

        // Backfill for sessions that pre-date the feature. Does not attach to a
        // specific upload because the latest upload cannot be reliably inferred.
        if (!insight) {
            const generated = await generateInsight({ userId })
            insight = await persistInsight(generated)
        }

        return NextResponse.json(
            { ok: true, insight },
            {
                headers: {
                    // Small cache window: insights update only on upload.
                    'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
                },
            },
        ) as NextResponse<InsightsApiResponse>
    } catch (e) {
        console.error('insights api error', e)
        return NextResponse.json(
            {
                ok: false,
                error: { code: 'DB_ERROR', message: e instanceof Error ? e.message : 'database error' },
            },
            { status: 500 },
        ) as NextResponse<InsightsApiResponse>
    }
}
