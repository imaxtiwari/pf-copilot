import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { db } from '../../../../lib/db'
import { dematHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'

export async function GET() {
    try {
        const { userId, isNew } = await resolveOrCreateUserId()

        const holdings = await db
            .select({
                id: dematHoldings.id,
                isin: dematHoldings.isin,
                companyName: dematHoldings.companyName,
                quantity: dematHoldings.quantity,
                price: dematHoldings.price,
                value: dematHoldings.value,
                asOfDate: dematHoldings.asOfDate,
                source: dematHoldings.source,
            })
            .from(dematHoldings)
            .where(eq(dematHoldings.userId, userId))
            .orderBy(desc(dematHoldings.value))

        const response = NextResponse.json(ok({ holdings }))
        if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
        return response
    } catch (e) {
        return NextResponse.json(
            err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
            { status: 500 },
        )
    }
}
