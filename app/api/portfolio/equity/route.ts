import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { db } from '../../../../lib/db'
import { dematHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { getCurrentUser } from '../../../../lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'

export async function GET() {
    try {
        const user = await getCurrentUser()
  if (!user) return unauthorizedResponse()
  const userId = user.userId

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
        return response
    } catch (e) {
        return NextResponse.json(
            err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
            { status: 500 },
        )
    }
}
