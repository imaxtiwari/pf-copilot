import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
    classifyHolding,
    buildAllocationTable,
    describeAgeBand,
    ageBasedEquityBand,
} from '../../lib/portfolio/allocation'
import { FORBIDDEN_IN_ASSISTANT_OUTPUT } from '../../lib/contracts/no-advice'

const forbidden = FORBIDDEN_IN_ASSISTANT_OUTPUT.map((w) => w.toLowerCase())

function containsForbidden(text: string): boolean {
    const lower = text.toLowerCase()
    return forbidden.some((word) => lower.includes(word))
}

// ── classifyHolding ───────────────────────────────────────────────────────────

describe('classifyHolding', () => {
    it('classifies AMFI category "Large Cap Fund" as Equity - Large Cap', () => {
        const h = classifyHolding('ABC Large Cap Fund', '12345', 1000, 'Large Cap Fund')
        expect(h.bucket).toBe('Equity - Large Cap')
    })

    it('classifies AMFI category "Mid Cap Fund" as Equity - Mid Cap', () => {
        const h = classifyHolding('ABC Mid Cap Fund', '12345', 1000, 'Mid Cap Fund')
        expect(h.bucket).toBe('Equity - Mid Cap')
    })

    it('classifies AMFI category "Small Cap Fund" as Equity - Small Cap', () => {
        const h = classifyHolding('ABC Small Cap Fund', '12345', 1000, 'Small Cap Fund')
        expect(h.bucket).toBe('Equity - Small Cap')
    })

    it('classifies AMFI category "Flexi Cap Fund" as Equity - Multi/ Flexi/ Focused', () => {
        const h = classifyHolding('ABC Flexi Cap Fund', '12345', 1000, 'Flexi Cap Fund')
        expect(h.bucket).toBe('Equity - Multi/ Flexi/ Focused')
    })

    it('classifies AMFI category "ELSS" as ELSS (Tax Saver)', () => {
        const h = classifyHolding('ABC Tax Saver Fund', '12345', 1000, 'ELSS')
        expect(h.bucket).toBe('ELSS (Tax Saver)')
    })

    it('classifies AMFI category "Liquid Fund" as Liquid', () => {
        const h = classifyHolding('ABC Liquid Fund', '12345', 1000, 'Liquid Fund')
        expect(h.bucket).toBe('Liquid')
    })

    it('classifies AMFI category "Corporate Bond Fund" as Debt', () => {
        const h = classifyHolding('ABC Corporate Bond Fund', '12345', 1000, 'Corporate Bond Fund')
        expect(h.bucket).toBe('Debt')
    })

    it('classifies AMFI category "Aggressive Hybrid Fund" as Hybrid', () => {
        const h = classifyHolding('ABC Aggressive Hybrid Fund', '12345', 1000, 'Aggressive Hybrid Fund')
        expect(h.bucket).toBe('Hybrid')
    })

    it('classifies AMFI category "Index Funds" as Other', () => {
        const h = classifyHolding('ABC Nifty 50 Index Fund', '12345', 1000, 'Index Funds')
        expect(h.bucket).toBe('Other')
    })

    it('falls back to scheme name when AMFI category is missing', () => {
        const h = classifyHolding('ABC Liquid Fund', null, 1000, null)
        expect(h.bucket).toBe('Liquid')
    })

    it('falls back to scheme name for debt when category is missing', () => {
        const h = classifyHolding('ABC Gilt Fund', null, 1000, null)
        expect(h.bucket).toBe('Debt')
    })

    it('returns Uncategorized when nothing matches', () => {
        const h = classifyHolding('Some Unknown Plan', null, 1000, null)
        expect(h.bucket).toBe('Uncategorized')
    })
})

// ── buildAllocationTable ──────────────────────────────────────────────────────

describe('buildAllocationTable', () => {
    it('sums values, weights, and lists top holdings sorted by value', () => {
        const holdings = [
            classifyHolding('Large Cap A', null, 5000, 'Large Cap Fund'),
            classifyHolding('Mid Cap A', null, 3000, 'Mid Cap Fund'),
            classifyHolding('Debt A', null, 2000, 'Debt Fund'),
        ]

        const table = buildAllocationTable(holdings)
        expect(table.totalValue).toBe(10000)
        expect(table.buckets['Equity - Large Cap'].value).toBe(5000)
        expect(table.buckets['Equity - Large Cap'].weight).toBe(0.5)
        expect(table.buckets['Equity - Mid Cap'].weight).toBe(0.3)
        expect(table.buckets['Debt'].weight).toBe(0.2)
        expect(table.topHoldings[0].schemeName).toBe('Large Cap A')
        expect(table.topHoldings).toHaveLength(3)
        expect(table.unknownWeight).toBe(0)
    })

    it('treats Other + Uncategorized as unknown weight', () => {
        const holdings = [
            classifyHolding('Index Fund', null, 4000, 'Index Funds'),
            classifyHolding('Mystery Fund', null, 1000, null),
        ]
        const table = buildAllocationTable(holdings)
        expect(table.unknownValue).toBe(5000)
        expect(table.unknownWeight).toBe(1)
    })

    it('handles empty holdings gracefully', () => {
        const table = buildAllocationTable([])
        expect(table.totalValue).toBe(0)
        expect(table.unknownWeight).toBe(0)
        expect(table.topHoldings).toHaveLength(0)
        Object.values(table.buckets).forEach((b) => {
            expect(b.value).toBe(0)
            expect(b.weight).toBe(0)
        })
    })
})

// ── age based helpers ─────────────────────────────────────────────────────────

describe('ageBasedEquityBand', () => {
    it('returns 0-0 when age is missing', () => {
        expect(ageBasedEquityBand(null)).toEqual({ min: 0, max: 0 })
        expect(ageBasedEquityBand(undefined)).toEqual({ min: 0, max: 0 })
    })

    it('returns wider equity band for younger ages', () => {
        expect(ageBasedEquityBand(25)).toEqual({ min: 0.7, max: 0.9 })
        expect(ageBasedEquityBand(35)).toEqual({ min: 0.6, max: 0.8 })
    })

    it('returns narrower equity band for older ages', () => {
        expect(ageBasedEquityBand(55)).toEqual({ min: 0.3, max: 0.5 })
        expect(ageBasedEquityBand(65)).toEqual({ min: 0.15, max: 0.35 })
    })
})

describe('describeAgeBand', () => {
    it('identifies each decade band', () => {
        expect(describeAgeBand(25).label).toBe('20s reference band')
        expect(describeAgeBand(35).label).toBe('30s reference band')
        expect(describeAgeBand(45).label).toBe('40s reference band')
        expect(describeAgeBand(55).label).toBe('50s reference band')
        expect(describeAgeBand(65).label).toBe('60+ reference band')
        expect(describeAgeBand(null).label).toBe('No age shared')
    })

    it('uses "many investors" framing, not personalised recommendations', () => {
        const d = describeAgeBand(35)
        expect(d.description.toLowerCase()).toContain('many investors')
        expect(d.description.toLowerCase()).not.toContain('you should')
    })

    it('never contains forbidden advisory words', () => {
        const texts = [
            describeAgeBand(null).description,
            describeAgeBand(25).description,
            describeAgeBand(35).description,
            describeAgeBand(45).description,
            describeAgeBand(55).description,
            describeAgeBand(65).description,
        ]
        for (const text of texts) {
            expect(containsForbidden(text)).toBe(false)
        }
    })
})

// ── UI copy anti-advisory check ───────────────────────────────────────────────

describe('portfolio page allocation copy', () => {
    it('does not contain forbidden advisory words in app/portfolio/page.tsx', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../app/portfolio/page.tsx'), 'utf8')
        const lower = source.toLowerCase()
        for (const word of forbidden) {
            if (lower.includes(word)) {
                throw new Error(`Found forbidden advisory word "${word}" in app/portfolio/page.tsx`)
            }
        }
    })
})
