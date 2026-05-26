import { eq, desc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'

// ── types ─────────────────────────────────────────────────────────────────────

export type PortfolioHoldingSummary = {
  scheme_name: string
  scheme_code: string | null
  market_value: number
  units: number
  nav: number
  as_of_date: string
}

export type GetPortfolioResult = {
  holdings: PortfolioHoldingSummary[]
  truncated: { count: number; total_value: number } | null
  total_value: number
  asset_mix: Record<string, number>
}

// ── helpers ───────────────────────────────────────────────────────────────────

const HOLDING_CAP = 30

async function computeAssetMix(
  allHoldings: (typeof schema.portfolioHoldings.$inferSelect)[],
): Promise<Record<string, number>> {
  const total = allHoldings.reduce((sum, h) => sum + Number(h.marketValue), 0)
  if (total === 0) return {}

  // Collect unique scheme codes that have an AMFI entry
  const schemeCodes = [...new Set(allHoldings.filter((h) => h.schemeCode).map((h) => h.schemeCode!))]

  const schemeTypes = schemeCodes.length > 0
    ? await db
        .select({
          schemeCode: schema.amfiSchemeMaster.schemeCode,
          schemeType: schema.amfiSchemeMaster.schemeType,
        })
        .from(schema.amfiSchemeMaster)
        .where(inArray(schema.amfiSchemeMaster.schemeCode, schemeCodes))
    : []

  const typeByCode = new Map(schemeTypes.map((s) => [s.schemeCode, s.schemeType]))

  const byType: Record<string, number> = {}
  for (const h of allHoldings) {
    const type = h.schemeCode ? (typeByCode.get(h.schemeCode) ?? 'Unknown') : 'Unknown'
    byType[type] = (byType[type] ?? 0) + Number(h.marketValue)
  }

  // Convert to percentages (rounded to 2 dp)
  const mix: Record<string, number> = {}
  for (const [type, value] of Object.entries(byType)) {
    mix[type] = Math.round((value / total) * 10000) / 100
  }
  return mix
}

// ── main export ───────────────────────────────────────────────────────────────

export async function getPortfolio(userId: string): Promise<GetPortfolioResult> {
  const allHoldings = await db
    .select()
    .from(schema.portfolioHoldings)
    .where(eq(schema.portfolioHoldings.userId, userId))
    .orderBy(desc(schema.portfolioHoldings.marketValue))

  const top = allHoldings.slice(0, HOLDING_CAP)
  const tail = allHoldings.slice(HOLDING_CAP)

  const truncated =
    tail.length > 0
      ? {
          count: tail.length,
          total_value: tail.reduce((s, h) => s + Number(h.marketValue), 0),
        }
      : null

  const total_value = allHoldings.reduce((s, h) => s + Number(h.marketValue), 0)
  const asset_mix = await computeAssetMix(allHoldings)

  return {
    holdings: top.map((h) => ({
      scheme_name: h.schemeName,
      scheme_code: h.schemeCode,
      market_value: Number(h.marketValue),
      units: Number(h.units),
      nav: Number(h.nav),
      as_of_date: h.asOfDate,
    })),
    truncated,
    total_value,
    asset_mix,
  }
}
