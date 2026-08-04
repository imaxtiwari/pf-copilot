import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { computeRealReturns } from '../inflation/real-returns'
import { parseNominalReturn1y } from '../inflation/parse-return'
import { computePersonalInflation } from '../inflation/compute'
import type { UserProfileInput } from '../inflation/compute'
import type { InflationConfidence } from '../validation/schemas'

export type SnapshotRow = {
    id: string
    asOfDate: string
    totalValue: number
    realReturnAnnualized: number | null
    inflationRateUsed: number
}

export async function getUserInflationRate(userId: string): Promise<{
    rate: number
    confidence: InflationConfidence
}> {
    const profile = await db.query.userProfile.findFirst({
        where: eq(schema.userProfile.userId, userId),
    })

    if (profile?.inflationRate) {
        return {
            rate: Number(profile.inflationRate),
            confidence: (profile.inflationConfidence as InflationConfidence) ?? 'low',
        }
    }

    const input: UserProfileInput = {
        age: profile?.age ?? undefined,
        city_tier: (profile?.cityTier as UserProfileInput['city_tier']) ?? undefined,
        monthly_rent: profile?.monthlyRent ? Number(profile.monthlyRent) : undefined,
        owns_home: profile?.ownsHome ?? undefined,
        dependents: (profile?.dependents as UserProfileInput['dependents']) ?? undefined,
        medical_conditions: profile?.medicalConditions ?? undefined,
    }

    const computed = computePersonalInflation(input)
    return { rate: computed.rate, confidence: computed.confidence }
}

async function getReturnsChunks(schemeCodes: string[]) {
    if (schemeCodes.length === 0) return []

    const rows = await db.execute<{
        scheme_code: string
        chunk_text: string
        factsheet_date: string
    }>(
        sql`
      SELECT DISTINCT ON (scheme_code)
        scheme_code,
        chunk_text,
        factsheet_date
      FROM factsheet_chunks
      WHERE scheme_code = ANY(${schemeCodes}::text[])
        AND section = 'returns'
      ORDER BY scheme_code, factsheet_date DESC
    `,
    )

    return rows.rows.map((r) => ({
        schemeCode: r.scheme_code,
        chunkText: r.chunk_text,
        factsheetDate: r.factsheet_date,
    }))
}

export async function buildSnapshots(userId: string): Promise<SnapshotRow[]> {
    const { rate: inflationRate } = await getUserInflationRate(userId)

    const holdings = await db
        .select({
            schemeCode: schema.portfolioHoldings.schemeCode,
            schemeName: schema.portfolioHoldings.schemeName,
            marketValue: schema.portfolioHoldings.marketValue,
            asOfDate: schema.portfolioHoldings.asOfDate,
        })
        .from(schema.portfolioHoldings)
        .where(eq(schema.portfolioHoldings.userId, userId))
        .orderBy(schema.portfolioHoldings.asOfDate)

    if (holdings.length === 0) return []

    const schemeCodes = [...new Set(holdings.filter((h) => h.schemeCode).map((h) => h.schemeCode!))]
    const returnsChunks = await getReturnsChunks(schemeCodes)
    const returnsMap = new Map(
        returnsChunks.map((c) => [c.schemeCode, { chunkText: c.chunkText, factsheetDate: c.factsheetDate }]),
    )

    const grouped = new Map<string, typeof holdings>()
    for (const h of holdings) {
        const key = h.asOfDate
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(h)
    }

    const snapshots: SnapshotRow[] = []

    for (const [asOfDate, group] of grouped) {
        const inputs = group.map((h) => {
            const entry = h.schemeCode ? returnsMap.get(h.schemeCode) : undefined
            return {
                scheme_code: h.schemeCode,
                scheme_name: h.schemeName,
                market_value: Number(h.marketValue),
                nominal_return_1y: entry ? parseNominalReturn1y(entry.chunkText) : null,
                factsheet_date: entry?.factsheetDate ?? null,
            }
        })

        const result = computeRealReturns(inputs, inflationRate)
        snapshots.push({
            id: '', // filled by DB
            asOfDate,
            totalValue: result.portfolio.total_value,
            realReturnAnnualized: result.portfolio.weighted_real_return_1y,
            inflationRateUsed: inflationRate,
        })
    }

    return snapshots
}

export async function refreshSnapshots(userId: string): Promise<SnapshotRow[]> {
    const snapshots = await buildSnapshots(userId)

    for (const s of snapshots) {
        await db
            .insert(schema.portfolioSnapshots)
            .values({
                userId,
                asOfDate: s.asOfDate,
                totalValue: String(s.totalValue),
                realReturnAnnualized: s.realReturnAnnualized !== null ? String(s.realReturnAnnualized) : null,
                inflationRateUsed: String(s.inflationRateUsed),
            })
            .onConflictDoUpdate({
                target: [schema.portfolioSnapshots.userId, schema.portfolioSnapshots.asOfDate],
                set: {
                    totalValue: String(s.totalValue),
                    realReturnAnnualized: s.realReturnAnnualized !== null ? String(s.realReturnAnnualized) : null,
                    inflationRateUsed: String(s.inflationRateUsed),
                },
            })
    }

    // Delete snapshots for dates that no longer have holdings
    const dates = snapshots.map((s) => s.asOfDate)
    if (dates.length > 0) {
        await db.execute(
            sql`
        DELETE FROM portfolio_snapshots
        WHERE user_id = ${userId}
          AND as_of_date NOT IN (${sql.join(dates.map((d) => sql`${d}`), sql`, `)})
      `,
        )
    }

    // Refetch from DB so IDs are populated
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

    return rows.map((r) => ({
        id: r.id,
        asOfDate: r.asOfDate,
        totalValue: Number(r.totalValue),
        realReturnAnnualized: r.realReturnAnnualized !== null ? Number(r.realReturnAnnualized) : null,
        inflationRateUsed: Number(r.inflationRateUsed),
    }))
}
