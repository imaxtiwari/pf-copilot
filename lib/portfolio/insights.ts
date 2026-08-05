import { eq, desc, sql } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import { getUserInflationRate } from './snapshots'
import { computeRealReturns } from '../inflation/real-returns'
import { parseNominalReturn1y } from '../inflation/parse-return'
import { classifyHolding } from './allocation'

export const INSIGHT_TEMPLATES = [
    'personal_inflation_vs_cpi',
    'highest_lowest_real_return',
    'mid_small_cap_concentration',
    'unmatched_schemes',
] as const
export type InsightTemplate = (typeof INSIGHT_TEMPLATES)[number]

const CPI_ANNUAL_ESTIMATE = 0.06

export type Insight = {
    id: string
    userId: string
    casUploadId: string | null
    template: InsightTemplate
    title: string
    body: string
    data: Record<string, string | number | null>
    generatedAt: string
}

export type InsightInput = {
    userId: string
    uploadId?: string | undefined
    /** Override inflation rate for deterministic unit tests */
    inflationRate?: number
    /** Override holdings for deterministic unit tests */
    holdings?: TestHolding[]
    /** Override unmatched schemes count for deterministic unit tests */
    unmatchedCount?: number
}

type TestHolding = {
    schemeName: string
    schemeCode: string | null
    marketValue: number
    nominalReturn1y?: number | null
    amfiCategory?: string | null
}

function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—'
    return `${(value * 100).toFixed(2)}%`
}

function findDebtFunds(holdings: MappedHolding[]) {
    const debt = holdings.filter((h) => {
        const bucket = classifyHolding(h.schemeName, h.schemeCode, h.marketValue, h.amfiCategory).bucket
        return bucket === 'Debt'
    })
    const debtValue = debt.reduce((s, h) => s + h.marketValue, 0)
    const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0)
    return { debt, debtValue, debtWeight: totalValue > 0 ? debtValue / totalValue : 0, totalValue }
}

type MappedHolding = {
    schemeName: string
    schemeCode: string | null
    marketValue: number
    nominalReturn1y: number | null
    amfiCategory: string | null
}

async function loadHoldingsReal(input: InsightInput): Promise<MappedHolding[]> {
    if (input.holdings) {
        return input.holdings.map((h) => ({
            schemeName: h.schemeName,
            schemeCode: h.schemeCode,
            marketValue: h.marketValue,
            nominalReturn1y: h.nominalReturn1y ?? null,
            amfiCategory: h.amfiCategory ?? null,
        }))
    }

    const rows = await db
        .select({
            schemeName: schema.portfolioHoldings.schemeName,
            schemeCode: schema.portfolioHoldings.schemeCode,
            marketValue: schema.portfolioHoldings.marketValue,
        })
        .from(schema.portfolioHoldings)
        .where(eq(schema.portfolioHoldings.userId, input.userId))

    if (rows.length === 0) return []

    const schemeCodes = [...new Set(rows.filter((h) => h.schemeCode).map((h) => h.schemeCode!))]

    const [returnsResult, categoryResult] = await Promise.all([
        schemeCodes.length > 0
            ? db.execute<{ scheme_code: string; chunk_text: string; factsheet_date: string }>(
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
            : Promise.resolve({ rows: [] } as { rows: { scheme_code: string; chunk_text: string; factsheet_date: string }[] }),
        schemeCodes.length > 0
            ? db.execute<{ scheme_code: string; amfi_category: string | null }>(
                sql`
        SELECT scheme_code, amfi_category
        FROM amfi_scheme_master
        WHERE scheme_code = ANY(${schemeCodes}::text[])
      `,
            )
            : Promise.resolve({ rows: [] } as { rows: { scheme_code: string; amfi_category: string | null }[] }),
    ])

    const returnsMap = new Map(returnsResult.rows.map((r) => [r.scheme_code, r.chunk_text]))
    const categoryMap = new Map(categoryResult.rows.map((r) => [r.scheme_code, r.amfi_category]))

    return rows.map((r) => {
        const code = r.schemeCode
        const nominalReturn1y = code ? parseNominalReturn1y(returnsMap.get(code) ?? '') : null
        return {
            schemeName: r.schemeName,
            schemeCode: code,
            marketValue: Number(r.marketValue),
            nominalReturn1y,
            amfiCategory: code ? categoryMap.get(code) ?? null : null,
        }
    })
}

/**
 * Determine which insight template is best for the current portfolio.
 *
 * Priority order is intentionally educational, deterministic, and non-advisory:
 * 1. Unmatched schemes – data quality issue is important to surface.
 * 2. Personal inflation vs CPI – helps interpret debt/equity split.
 * 3. Highest/lowest real return – when factsheet data available.
 * 4. Mid/small-cap concentration – equity risk framing.
 */
export function selectTemplate(inputs: {
    unmatchedCount: number
    holdings: MappedHolding[]
    inflationRate: number
    debtWeight: number
}): InsightTemplate {
    if (inputs.unmatchedCount > 0) return 'unmatched_schemes'

    const hasReturnData = inputs.holdings.some((h) => h.nominalReturn1y !== null)
    if (inputs.debtWeight > 0.2 && hasReturnData) {
        // Prefer real-return explainers for debt-heavy portfolios
        const { per_holding } = computeRealReturns(
            inputs.holdings
                .filter((h) => h.nominalReturn1y !== null)
                .map((h) => ({
                    scheme_code: h.schemeCode,
                    scheme_name: h.schemeName,
                    market_value: h.marketValue,
                    nominal_return_1y: h.nominalReturn1y,
                    factsheet_date: null,
                })),
            inputs.inflationRate,
        )
        if (per_holding.some((h) => h.real_return_1y !== null)) return 'highest_lowest_real_return'
    }

    if (inputs.debtWeight > 0.2 && inputs.inflationRate > CPI_ANNUAL_ESTIMATE) {
        return 'personal_inflation_vs_cpi'
    }

    const midSmallWeight = inputs.holdings.reduce((sum, h) => {
        const bucket = classifyHolding(h.schemeName, h.schemeCode, h.marketValue, h.amfiCategory).bucket
        if (bucket === 'Equity - Mid Cap' || bucket === 'Equity - Small Cap') return sum + h.marketValue
        return sum
    }, 0)
    const totalValue = inputs.holdings.reduce((s, h) => s + h.marketValue, 0)
    if (totalValue > 0 && midSmallWeight / totalValue > 0.15) return 'mid_small_cap_concentration'

    if (hasReturnData) return 'highest_lowest_real_return'

    return 'personal_inflation_vs_cpi'
}

function buildPersonalInflationInsight(
    input: InsightInput,
    holdings: MappedHolding[],
    inflationRate: number,
): Insight {
    const diff = inflationRate - CPI_ANNUAL_ESTIMATE
    const sign = diff >= 0 ? 'above' : 'below'
    const { debtWeight } = findDebtFunds(holdings)
    const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0)

    return {
        id: '',
        userId: input.userId,
        casUploadId: input.uploadId ?? null,
        template: 'personal_inflation_vs_cpi',
        title: 'Your personal inflation rate',
        body:
            `Your personal inflation rate is ${formatPercent(inflationRate)}, ` +
            `${formatPercent(Math.abs(diff))} ${sign} the latest RBI/CPI estimate. ` +
            `That matters especially for the ${formatPercent(debtWeight)} of your portfolio in debt funds, ` +
            `because their post-inflation return may be lower than it first appears.`,
        data: {
            personalInflation: inflationRate,
            cpiEstimate: CPI_ANNUAL_ESTIMATE,
            diff,
            debtWeight,
            totalValue,
            debtValue: totalValue * debtWeight,
        },
        generatedAt: new Date().toISOString(),
    }
}

function buildHighestLowestRealReturn(
    input: InsightInput,
    holdings: MappedHolding[],
    inflationRate: number,
): Insight {
    const withReturns = holdings.filter((h) => h.nominalReturn1y !== null).map((h) => ({
        scheme_code: h.schemeCode,
        scheme_name: h.schemeName,
        market_value: h.marketValue,
        nominal_return_1y: h.nominalReturn1y,
        factsheet_date: null,
    }))

    const result = computeRealReturns(withReturns, inflationRate)
    const ranked = result.per_holding
        .filter((h) => h.real_return_1y !== null)
        .sort((a, b) => b.real_return_1y! - a.real_return_1y!)

    const highest = ranked[0]
    const lowest = ranked[ranked.length - 1]

    return {
        id: '',
        userId: input.userId,
        casUploadId: input.uploadId ?? null,
        template: 'highest_lowest_real_return',
        title: 'Real return leaders and laggards',
        body:
            `Your highest real return is ${highest?.scheme_name} at ${formatPercent(highest?.real_return_1y)}, ` +
            `and the lowest is ${lowest?.scheme_name} at ${formatPercent(lowest?.real_return_1y)}. ` +
            'These numbers subtract your personal inflation from the fund’s 1-year trailing return.',
        data: {
            highestFund: highest?.scheme_name ?? null,
            highestRealReturn: highest?.real_return_1y ?? null,
            lowestFund: lowest?.scheme_name ?? null,
            lowestRealReturn: lowest?.real_return_1y ?? null,
            inflationRate,
            holdingsUsed: withReturns.length,
            totalHoldings: holdings.length,
        },
        generatedAt: new Date().toISOString(),
    }
}

function buildMidSmallCapConcentration(input: InsightInput, holdings: MappedHolding[]): Insight {
    let midSmallValue = 0
    let totalValue = 0
    for (const h of holdings) {
        totalValue += h.marketValue
        const bucket = classifyHolding(h.schemeName, h.schemeCode, h.marketValue, h.amfiCategory).bucket
        if (bucket === 'Equity - Mid Cap' || bucket === 'Equity - Small Cap') {
            midSmallValue += h.marketValue
        }
    }

    const weight = totalValue > 0 ? midSmallValue / totalValue : 0

    return {
        id: '',
        userId: input.userId,
        casUploadId: input.uploadId ?? null,
        template: 'mid_small_cap_concentration',
        title: 'Mid and small-cap exposure',
        body:
            `${formatPercent(weight)} of your portfolio is in mid or small-cap funds. ` +
            'These categories tend to be more volatile than large-cap funds, so expect larger short-term swings.',
        data: {
            midSmallWeight: weight,
            midSmallValue,
            totalValue,
            holdingCount: holdings.length,
        },
        generatedAt: new Date().toISOString(),
    }
}

function buildUnmatchedSchemes(input: InsightInput, unmatchedCount: number): Insight {
    return {
        id: '',
        userId: input.userId,
        casUploadId: input.uploadId ?? null,
        template: 'unmatched_schemes',
        title: 'Unmatched schemes',
        body:
            `We could not match ${unmatchedCount} scheme${unmatchedCount === 1 ? '' : 's'} to the AMFI master. ` +
            'Their factsheet or category data may be outdated, so return and allocation numbers may be incomplete.',
        data: {
            unmatchedCount,
            uploadId: input.uploadId ?? null,
        },
        generatedAt: new Date().toISOString(),
    }
}

export async function generateInsight(input: InsightInput): Promise<Insight> {
    const inflationRate =
        input.inflationRate ?? (await getUserInflationRate(input.userId)).rate
    const holdings = await loadHoldingsReal(input)
    const unmatchedCount = input.unmatchedCount ?? (await getLatestUploadUnmatchedCount(input.userId, input.uploadId))

    let { debtWeight } = findDebtFunds(holdings)

    // Graceful empty portfolio
    if (holdings.length === 0) {
        return buildPersonalInflationInsight(input, holdings, inflationRate)
    }

    const template = selectTemplate({ unmatchedCount, holdings, inflationRate, debtWeight })

    switch (template) {
        case 'personal_inflation_vs_cpi':
            return buildPersonalInflationInsight(input, holdings, inflationRate)
        case 'highest_lowest_real_return':
            return buildHighestLowestRealReturn(input, holdings, inflationRate)
        case 'mid_small_cap_concentration':
            return buildMidSmallCapConcentration(input, holdings)
        case 'unmatched_schemes':
            return buildUnmatchedSchemes(input, unmatchedCount)
        default:
            return buildPersonalInflationInsight(input, holdings, inflationRate)
    }
}

async function getLatestUploadUnmatchedCount(userId: string, explicitUploadId?: string): Promise<number> {
    if (explicitUploadId) {
        const upload = await db.query.casUploads.findFirst({
            where: eq(schema.casUploads.id, explicitUploadId),
        })
        const errs = upload?.validationErrors
        if (errs && Array.isArray(errs)) {
            const unmatched = errs.find((e: { code?: string }) => e.code === 'unmatched_schemes')
            if (unmatched && Array.isArray(unmatched.schemes)) return unmatched.schemes.length
        }
        return 0
    }

    const [latest] = await db
        .select({ id: schema.casUploads.id, validationErrors: schema.casUploads.validationErrors })
        .from(schema.casUploads)
        .where(eq(schema.casUploads.userId, userId))
        .orderBy(desc(schema.casUploads.uploadedAt))
        .limit(1)

    if (!latest) return 0
    const errs = latest.validationErrors
    if (errs && Array.isArray(errs)) {
        const unmatched = errs.find((e: { code?: string }) => e.code === 'unmatched_schemes')
        if (unmatched && Array.isArray(unmatched.schemes)) return unmatched.schemes.length
    }
    return 0
}

export async function persistInsight(insight: Omit<Insight, 'id' | 'generatedAt'>): Promise<Insight> {
    const [row] = await db
        .insert(schema.portfolioInsights)
        .values({
            userId: insight.userId,
            casUploadId: insight.casUploadId,
            template: insight.template,
            title: insight.title,
            body: insight.body,
            data: insight.data,
        })
        .returning({
            id: schema.portfolioInsights.id,
            generatedAt: schema.portfolioInsights.generatedAt,
        })

    return {
        ...insight,
        id: row.id,
        generatedAt: row.generatedAt.toISOString(),
    }
}

export async function getLatestInsight(userId: string): Promise<Insight | null> {
    const row = await db.query.portfolioInsights.findFirst({
        where: eq(schema.portfolioInsights.userId, userId),
        orderBy: [desc(schema.portfolioInsights.generatedAt)],
    })

    if (!row) return null

    return {
        id: row.id,
        userId: row.userId,
        casUploadId: row.casUploadId,
        template: row.template as InsightTemplate,
        title: row.title,
        body: row.body,
        data: (row.data ?? {}) as Record<string, string | number | null>,
        generatedAt: row.generatedAt.toISOString(),
    }
}
