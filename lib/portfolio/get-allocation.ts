import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { classifyHolding, buildAllocationTable } from './allocation'

export type AllocationView = {
    ok: true
    data: {
        buckets: Array<{
            bucket: string
            value: number
            weight: number
            holdingCount: number
        }>
        totalValue: number
        topHoldings: Array<{
            schemeName: string
            schemeCode: string | null
            marketValue: number
            bucket: string
            amfiCategory: string | null
        }>
        unknownWeight: number
    }
}

export async function getAllocationForUser(userId: string): Promise<AllocationView> {
    const holdings = await db
        .select({
            schemeCode: schema.portfolioHoldings.schemeCode,
            schemeName: schema.portfolioHoldings.schemeName,
            marketValue: schema.portfolioHoldings.marketValue,
        })
        .from(schema.portfolioHoldings)
        .where(eq(schema.portfolioHoldings.userId, userId))

    if (holdings.length === 0) {
        return {
            ok: true,
            data: {
                buckets: [],
                totalValue: 0,
                topHoldings: [],
                unknownWeight: 0,
            },
        }
    }

    const schemeCodes = [
        ...new Set(holdings.filter((h) => h.schemeCode).map((h) => h.schemeCode!)),
    ]

    const categoryRows =
        schemeCodes.length > 0
            ? await db
                .select({
                    schemeCode: schema.amfiSchemeMaster.schemeCode,
                    amfiCategory: schema.amfiSchemeMaster.amfiCategory,
                })
                .from(schema.amfiSchemeMaster)
                .where(inArray(schema.amfiSchemeMaster.schemeCode, schemeCodes))
            : []

    const categoryByCode = new Map(categoryRows.map((r) => [r.schemeCode, r.amfiCategory]))

    const classified = holdings.map((h) =>
        classifyHolding(
            h.schemeName,
            h.schemeCode,
            Number(h.marketValue),
            h.schemeCode ? categoryByCode.get(h.schemeCode) : null,
        ),
    )

    const table = buildAllocationTable(classified)

    return {
        ok: true,
        data: {
            buckets: Object.entries(table.buckets)
                .filter(([, b]) => b.value > 0)
                .map(([bucket, b]) => ({
                    bucket,
                    value: b.value,
                    weight: b.weight,
                    holdingCount: b.holdings.length,
                }))
                .sort((a, b) => b.value - a.value),
            totalValue: table.totalValue,
            topHoldings: table.topHoldings,
            unknownWeight: table.unknownWeight,
        },
    }
}
