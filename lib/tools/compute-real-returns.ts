import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'

export type RealReturnsResult = {
  scheme_code: string
  scheme_name: string | null
  your_holding: {
    units: number
    nav: number
    market_value: number
    as_of_date: string
  } | null
  personal_inflation_rate: number | null
  inflation_confidence: string | null
  factsheet_returns_data: string | null
  real_return_formula: string
  note: string | null
}

export async function computeRealReturns(
  schemeCode: string,
  userId: string,
): Promise<RealReturnsResult> {
  // 1. User's personal inflation rate
  const profile = await db.query.userProfile.findFirst({
    where: eq(schema.userProfile.userId, userId),
  })
  const inflationRate = profile?.inflationRate ? Number(profile.inflationRate) : null

  // 2. User's holding for this scheme
  const holding = await db.query.portfolioHoldings.findFirst({
    where: and(
      eq(schema.portfolioHoldings.userId, userId),
      eq(schema.portfolioHoldings.schemeCode, schemeCode),
    ),
  })

  // 3. Most recent returns chunk from factsheet
  const returnsChunks = await db
    .select({
      chunkText: schema.factsheetChunks.chunkText,
      factsheetDate: schema.factsheetChunks.factsheetDate,
      schemeName: schema.factsheetChunks.schemeName,
    })
    .from(schema.factsheetChunks)
    .where(
      and(
        eq(schema.factsheetChunks.schemeCode, schemeCode),
        eq(schema.factsheetChunks.section, 'returns'),
      ),
    )
    .orderBy(desc(schema.factsheetChunks.factsheetDate))
    .limit(2)

  const schemeName = returnsChunks[0]?.schemeName ?? holding?.schemeName ?? null
  const factsheetReturnsData =
    returnsChunks.length > 0
      ? returnsChunks.map((c: any) => `[${c.factsheetDate}]:\n${c.chunkText}`).join('\n\n---\n\n')
      : null

  return {
    scheme_code: schemeCode,
    scheme_name: schemeName,
    your_holding: holding
      ? {
          units: Number(holding.units),
          nav: Number(holding.nav),
          market_value: Number(holding.marketValue),
          as_of_date: holding.asOfDate,
        }
      : null,
    personal_inflation_rate: inflationRate,
    inflation_confidence: profile?.inflationConfidence ?? null,
    factsheet_returns_data: factsheetReturnsData,
    real_return_formula:
      'real_return = (1 + nominal_return) / (1 + personal_inflation_rate) - 1',
    note: !inflationRate
      ? 'No personal inflation rate found. Complete onboarding at /onboarding to enable real return calculation.'
      : !factsheetReturnsData
      ? 'No factsheet returns data available. Run the factsheet ingestion script for this scheme.'
      : null,
  }
}
