import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../../lib/db'
import * as schema from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'
import { computePortfolioXIRR } from '../../../../lib/portfolio/xirr'

function computeRollingReturn(
    snapshots: { asOfDate: string; totalValue: number }[],
    index: number,
    years: number,
): number | null {
    const current = snapshots[index]
    const targetDate = new Date(current.asOfDate)
    targetDate.setFullYear(targetDate.getFullYear() - years)

    // Find the closest snapshot on or before targetDate
    for (let i = index - 1; i >= 0; i--) {
        const snapshotDate = new Date(snapshots[i].asOfDate)
        if (snapshotDate <= targetDate) {
            const cagr = Math.pow(current.totalValue / snapshots[i].totalValue, 1 / years) - 1
            return Math.round(cagr * 10000) / 10000
        }
    }

    return null
}

export async function GET() {
    const { userId, isNew } = await resolveOrCreateUserId()

    try {
        const rows = await db
            .select({
                id: schema.portfolioSnapshots.id,
                asOfDate: schema.portfolioSnapshots.asOfDate,
                totalValue: schema.portfolioSnapshots.totalValue,
                realReturnAnnualized: schema.portfolioSnapshots.realReturnAnnualized,
                inflationRateUsed: schema.portfolioSnapshots.inflationRateUsed,
            })
            .from(schema.portfolioSnapshots)
            .where(eq(schema.portfolioSnapshots.userId, userId))
            .orderBy(schema.portfolioSnapshots.asOfDate)

        const snapshots = rows.map((r) => ({
            id: r.id,
            as_of_date: r.asOfDate,
            total_value: Number(r.totalValue),
            real_return_annualized: r.realReturnAnnualized !== null ? Number(r.realReturnAnnualized) : null,
            inflation_rate_used: Number(r.inflationRateUsed),
        }))

        const xirrInputs = snapshots.map((s) => ({ asOfDate: s.as_of_date, totalValue: s.total_value }))
        const xirr = computePortfolioXIRR(xirrInputs)

        const timeline = snapshots.map((s, i) => ({
            ...s,
            rolling_1y_real_return: computeRollingReturn(xirrInputs, i, 1),
            rolling_3y_real_return: computeRollingReturn(xirrInputs, i, 3),
        }))

        const response = NextResponse.json(ok({ snapshots: timeline, xirr }))
        if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
        return response
    } catch (e) {
        return NextResponse.json(
            err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
            { status: 500 },
        )
    }
}
