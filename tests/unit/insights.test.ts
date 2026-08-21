import { describe, it, expect } from 'vitest'
import {
    generateInsight,
    selectTemplate,
    INSIGHT_TEMPLATES,
    type InsightTemplate,
    type Insight,
} from '../../lib/portfolio/insights'

// Helper to create simple debt/equity test holdings with optional return data
function h(
    name: string,
    marketValue: number,
    opts?: { amfiCategory?: string; return1y?: number },
) {
    return {
        schemeName: name,
        schemeCode: opts?.amfiCategory ? `CODE-${name}` : null,
        marketValue,
        nominalReturn1y: opts?.return1y ?? null,
        amfiCategory: opts?.amfiCategory ?? null,
    }
}

describe('selectTemplate', () => {
    it('selects unmatched_schemes when any unmatched scheme exists', () => {
        const result = selectTemplate({
            unmatchedCount: 1,
            holdings: [h('Small Cap Fund', 100000, { amfiCategory: 'Small Cap Fund' })],
            inflationRate: 0.07,
            debtWeight: 0,
        })
        expect(result).toBe('unmatched_schemes')
    })

    it('selects highest_lowest_real_return when debt-heavy and return data is available', () => {
        const result = selectTemplate({
            unmatchedCount: 0,
            holdings: [
                h('Debt Fund A', 700000, { amfiCategory: 'Debt Fund', return1y: 0.08 }),
                h('Debt Fund B', 300000, { amfiCategory: 'Debt Fund', return1y: 0.06 }),
            ],
            inflationRate: 0.05,
            debtWeight: 1,
        })
        expect(result).toBe('highest_lowest_real_return')
    })

    it('selects personal_inflation_vs_cpi when debt-heavy, inflation is high, and no return data', () => {
        const result = selectTemplate({
            unmatchedCount: 0,
            holdings: [h('Corporate Bond Fund', 800000, { amfiCategory: 'Corporate Bond Fund' })],
            inflationRate: 0.07,
            debtWeight: 1,
        })
        expect(result).toBe('personal_inflation_vs_cpi')
    })

    it('selects mid_small_cap_concentration when mid/small weight exceeds threshold', () => {
        const result = selectTemplate({
            unmatchedCount: 0,
            holdings: [
                h('Mid Cap Fund', 160000, { amfiCategory: 'Mid Cap Fund' }),
                h('Large Cap Fund', 840000, { amfiCategory: 'Large Cap Fund' }),
            ],
            inflationRate: 0.05,
            debtWeight: 0,
        })
        expect(result).toBe('mid_small_cap_concentration')
    })

    it('selects highest_lowest_real_return for equity-heavy portfolios with return data', () => {
        const result = selectTemplate({
            unmatchedCount: 0,
            holdings: [
                h('Large Cap Fund', 400000, { amfiCategory: 'Large Cap Fund', return1y: 0.12 }),
                h('Mid Cap Fund', 300000, { amfiCategory: 'Mid Cap Fund', return1y: 0.18 }),
                h('Debt Fund', 300000, { amfiCategory: 'Debt Fund', return1y: 0.07 }),
            ],
            inflationRate: 0.05,
            debtWeight: 0.3,
        })
        expect(result).toBe('highest_lowest_real_return')
    })

    it('falls back to personal_inflation_vs_cpi when no specific condition matches', () => {
        const result = selectTemplate({
            unmatchedCount: 0,
            holdings: [h('Large Cap Fund', 100000, { amfiCategory: 'Large Cap Fund' })],
            inflationRate: 0.05,
            debtWeight: 0,
        })
        expect(result).toBe('personal_inflation_vs_cpi')
    })
})

describe('generateInsight (deterministic unit paths)', () => {
    it('generates an unmatched_schemes insight with upload link', async () => {
        const insight = await generateInsight({
            userId: 'user-test',
            uploadId: 'upload-test',
            holdings: [h('Mystery Scheme', 50000)],
            unmatchedCount: 2,
            inflationRate: 0.05,
        })
        expect(insight.template).toBe('unmatched_schemes')
        expect(insight.title).toBe('Unmatched schemes')
        expect(insight.body).toContain('2 schemes')
        expect(insight.body).toContain('AMFI master')
        expect(insight.data.unmatchedCount).toBe(2)
    })

    it('generates a personal inflation insight with correct sign', async () => {
        const insight = await generateInsight({
            userId: 'user-test',
            uploadId: 'upload-test',
            holdings: [
                h('Corporate Bond Fund', 900000, { amfiCategory: 'Corporate Bond Fund' }),
                h('Large Cap Fund', 100000, { amfiCategory: 'Large Cap Fund' }),
            ],
            unmatchedCount: 0,
            inflationRate: 0.08,
        })
        expect(insight.template).toBe('personal_inflation_vs_cpi')
        expect(insight.body).toContain('above')
        expect(insight.data.personalInflation).toBe(0.08)
        expect(insight.data.cpiEstimate).toBe(0.06)
    })

    it('generates a highest/lowest real return insight with computed real returns', async () => {
        const insight = await generateInsight({
            userId: 'user-test',
            uploadId: 'upload-test',
            holdings: [
                h('Debt Fund A', 500000, { amfiCategory: 'Debt Fund', return1y: 0.08 }),
                h('Debt Fund B', 500000, { amfiCategory: 'Debt Fund', return1y: 0.05 }),
            ],
            unmatchedCount: 0,
            inflationRate: 0.04,
        })
        expect(insight.template).toBe('highest_lowest_real_return')
        expect(insight.body).toContain('Debt Fund A')
        expect(insight.body).toContain('Debt Fund B')
        expect(insight.data.highestRealReturn).toBeGreaterThan(insight.data.lowestRealReturn as number)
    })

    it('generates a mid/small-cap concentration insight when threshold is crossed', async () => {
        const insight = await generateInsight({
            userId: 'user-test',
            uploadId: 'upload-test',
            holdings: [
                h('Large Cap Fund', 500000, { amfiCategory: 'Large Cap Fund', return1y: 0.1 }),
                h('Small Cap Fund', 500000, { amfiCategory: 'Small Cap Fund', return1y: 0.15 }),
            ],
            unmatchedCount: 0,
            inflationRate: 0.05,
        })
        expect(insight.template).toBe('mid_small_cap_concentration')
        expect((insight.data.midSmallWeight as number)).toBeCloseTo(0.5, 2)
        expect(insight.body).toContain('50.00%')
    })

    it('returns deterministic output for the same inputs', async () => {
        const input: Parameters<typeof generateInsight>[0] = {
            userId: 'user-test',
            uploadId: 'upload-test',
            holdings: [h('Debt Fund', 500000, { amfiCategory: 'Debt Fund', return1y: 0.07 })],
            unmatchedCount: 0,
            inflationRate: 0.05,
        }
        const a = await generateInsight(input)
        const b = await generateInsight(input)
        expect(a.template).toBe(b.template)
        expect(a.title).toBe(b.title)
        expect(a.body).toBe(b.body)
        expect(a.data).toEqual(b.data)
    })
})

describe('insight template metadata', () => {
    it('contains exactly the four documented templates', () => {
        expect(INSIGHT_TEMPLATES).toEqual([
            'personal_inflation_vs_cpi',
            'highest_lowest_real_return',
            'mid_small_cap_concentration',
            'unmatched_schemes',
        ])
    })
})
