/**
 * Portfolio allocation / classification engine.
 *
 * Maps AMFI categories and scheme names into broad educational buckets.
 * This module deliberately avoids investment advice; it only labels what the
 * user already holds.
 */

export type AllocationBucket =
    | 'Equity - Large Cap'
    | 'Equity - Mid Cap'
    | 'Equity - Small Cap'
    | 'Equity - Multi/ Flexi/ Focused'
    | 'Debt'
    | 'Liquid'
    | 'ELSS (Tax Saver)'
    | 'Hybrid'
    | 'Other'
    | 'Uncategorized'

export type ClassifiedHolding = {
    schemeName: string
    schemeCode: string | null
    marketValue: number
    bucket: AllocationBucket
    amfiCategory: string | null
}

export type AllocationTable = {
    buckets: Record<
        AllocationBucket,
        {
            value: number
            weight: number
            holdings: ClassifiedHolding[]
        }
    >
    totalValue: number
    topHoldings: ClassifiedHolding[]
    unknownValue: number
    unknownWeight: number
}

const BUCKET_ORDER: AllocationBucket[] = [
    'Equity - Large Cap',
    'Equity - Mid Cap',
    'Equity - Small Cap',
    'Equity - Multi/ Flexi/ Focused',
    'ELSS (Tax Saver)',
    'Hybrid',
    'Debt',
    'Liquid',
    'Other',
    'Uncategorized',
]

function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Classify a single holding into a broad bucket.
 *
 * Priority:
 * 1. AMFI category (most reliable)
 * 2. Scheme name keyword fallback
 * 3. Uncategorized if nothing matches
 */
export function classifyHolding(
    schemeName: string,
    schemeCode: string | null | undefined,
    marketValue: number,
    amfiCategory: string | null | undefined,
): ClassifiedHolding {
    const name = schemeName ?? ''
    const category = (amfiCategory ?? '').trim()
    const nName = normalize(name)
    const nCategory = normalize(category)

    let bucket: AllocationBucket = 'Uncategorized'

    // 1. AMFI category rules
    if (nCategory) {
        if (nCategory.includes('tax saver') || nCategory.includes('elss')) {
            bucket = 'ELSS (Tax Saver)'
        } else if (nCategory.includes('large cap')) {
            bucket = 'Equity - Large Cap'
        } else if (nCategory.includes('mid cap')) {
            bucket = 'Equity - Mid Cap'
        } else if (nCategory.includes('small cap')) {
            bucket = 'Equity - Small Cap'
        } else if (
            nCategory.includes('multi cap') ||
            nCategory.includes('flexi cap') ||
            nCategory.includes('focused') ||
            nCategory.includes('equity savings') ||
            nCategory.includes('balanced advantage') ||
            nCategory.includes('value') ||
            nCategory.includes('contra') ||
            nCategory.includes('dividend yield')
        ) {
            bucket = 'Equity - Multi/ Flexi/ Focused'
        } else if (
            nCategory.includes('hybrid') ||
            nCategory.includes('conservative') ||
            nCategory.includes('aggressive') ||
            nCategory.includes('arbitrage') ||
            nCategory.includes('equity savings')
        ) {
            bucket = 'Hybrid'
        } else if (
            nCategory.includes('liquid') ||
            nCategory.includes('money market') ||
            nCategory.includes('overnight')
        ) {
            bucket = 'Liquid'
        } else if (
            nCategory.includes('debt') ||
            nCategory.includes('gilt') ||
            nCategory.includes('corporate bond') ||
            nCategory.includes('credit risk') ||
            nCategory.includes('banking and psu') ||
            nCategory.includes('floater') ||
            nCategory.includes('medium duration') ||
            nCategory.includes('short duration') ||
            nCategory.includes('ultra short duration') ||
            nCategory.includes('low duration') ||
            nCategory.includes('dynamic bond')
        ) {
            bucket = 'Debt'
        } else if (
            nCategory.includes('index') ||
            nCategory.includes('etf') ||
            nCategory.includes('fund of funds') ||
            nCategory.includes('solution oriented') ||
            nCategory.includes('retirement') ||
            nCategory.includes('children')
        ) {
            bucket = 'Other'
        }
    }

    // 2. Name-based fallback (only if AMFI category didn't resolve to a real bucket)
    if (bucket === 'Uncategorized') {
        if (nName.includes('liquid')) {
            bucket = 'Liquid'
        } else if (nName.includes('elss') || nName.includes('tax saver')) {
            bucket = 'ELSS (Tax Saver)'
        } else if (nName.includes('small cap')) {
            bucket = 'Equity - Small Cap'
        } else if (nName.includes('mid cap')) {
            bucket = 'Equity - Mid Cap'
        } else if (nName.includes('large cap')) {
            bucket = 'Equity - Large Cap'
        } else if (
            nName.includes('flexi cap') ||
            nName.includes('multi cap') ||
            nName.includes('focused') ||
            nName.includes('contra') ||
            nName.includes('value') ||
            nName.includes('dividend yield')
        ) {
            bucket = 'Equity - Multi/ Flexi/ Focused'
        } else if (
            nName.includes('hybrid') ||
            nName.includes('balanced') ||
            nName.includes('equity savings') ||
            nName.includes('arbitrage')
        ) {
            bucket = 'Hybrid'
        } else if (
            nName.includes('debt') ||
            nName.includes('gilt') ||
            nName.includes('bond') ||
            nName.includes('money market') ||
            nName.includes('credit risk') ||
            nName.includes('corporate bond') ||
            nName.includes('banking') ||
            nName.includes('psu') ||
            nName.includes('floater')
        ) {
            bucket = 'Debt'
        }
    }

    return {
        schemeName: name,
        schemeCode: schemeCode ?? null,
        marketValue,
        bucket,
        amfiCategory: category || null,
    }
}

/**
 * Build a complete allocation table from classified holdings.
 */
export function buildAllocationTable(holdings: ClassifiedHolding[]): AllocationTable {
    const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)

    const emptyBuckets = Object.fromEntries(
        BUCKET_ORDER.map((b) => [b, { value: 0, weight: 0, holdings: [] as ClassifiedHolding[] }]),
    ) as AllocationTable['buckets']

    for (const h of holdings) {
        emptyBuckets[h.bucket].value += h.marketValue
        emptyBuckets[h.bucket].holdings.push(h)
    }

    const buckets = emptyBuckets
    for (const b of Object.values(buckets)) {
        b.weight = totalValue > 0 ? b.value / totalValue : 0
    }

    const sortedHoldings = [...holdings].sort((a, b) => b.marketValue - a.marketValue)

    return {
        buckets,
        totalValue,
        topHoldings: sortedHoldings.slice(0, 10),
        unknownValue: buckets.Uncategorized.value + buckets.Other.value,
        unknownWeight: buckets.Uncategorized.weight + buckets.Other.weight,
    }
}

/**
 * Age-based reference bands (strictly descriptive, not advisory).
 */
export function describeAgeBand(age: number | null | undefined): {
    label: string
    description: string
} {
    if (age === null || age === undefined) {
        return {
            label: 'No age shared',
            description:
                'Share your age on the onboarding page to see a reference allocation band used by many investors.',
        }
    }

    if (age < 30) {
        return {
            label: '20s reference band',
            description:
                'Many investors in their 20s keep a larger share in equity and a smaller share in debt. Your actual allocation can reflect your own goals and risk tolerance.',
        }
    }
    if (age < 40) {
        return {
            label: '30s reference band',
            description:
                'Many investors in their 30s hold a mix of equity and debt, gradually adding stability as goals get closer.',
        }
    }
    if (age < 50) {
        return {
            label: '40s reference band',
            description:
                'Many investors in their 40s hold moderate equity exposure with a meaningful debt allocation.',
        }
    }
    if (age < 60) {
        return {
            label: '50s reference band',
            description:
                'Many investors in their 50s lower equity exposure and build a larger debt or liquid allocation.',
        }
    }
    return {
        label: '60+ reference band',
        description:
            'Many investors above 60 keep a smaller equity allocation and emphasise stability and liquidity.',
    }
}

/**
 * Reference equity allocation used for the bar band.
 */
export function ageBasedEquityBand(age: number | null | undefined): {
    min: number
    max: number
} {
    if (age === null || age === undefined) return { min: 0, max: 0 }
    if (age < 30) return { min: 0.7, max: 0.9 }
    if (age < 40) return { min: 0.6, max: 0.8 }
    if (age < 50) return { min: 0.45, max: 0.65 }
    if (age < 60) return { min: 0.3, max: 0.5 }
    return { min: 0.15, max: 0.35 }
}
