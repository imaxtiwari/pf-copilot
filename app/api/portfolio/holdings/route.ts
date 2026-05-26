import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../../lib/db'
import { portfolioHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'

export async function GET() {
  try {
    const { userId, isNew } = await resolveOrCreateUserId()

    const holdings = await db
      .select({
        id: portfolioHoldings.id,
        schemeName: portfolioHoldings.schemeName,
        folioNumber: portfolioHoldings.folioNumber,
        units: portfolioHoldings.units,
        nav: portfolioHoldings.nav,
        marketValue: portfolioHoldings.marketValue,
        asOfDate: portfolioHoldings.asOfDate,
        source: portfolioHoldings.source,
      })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId))
      .orderBy(portfolioHoldings.asOfDate)

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
