import { describe, it, expect } from 'vitest'
import {
  validatePortfolioDraft,
  type PortfolioDraft,
  type FundSnapshot,
} from '@/lib/validation/portfolio-draft'

describe('validatePortfolioDraft', () => {
  const universe: Record<string, FundSnapshot> = {
    INF209K01UN8: { category: 'Large Cap Fund', isIndex: false },
    INF740K01QQ4: { category: 'Mid Cap Fund', isIndex: false },
    INF769K01EW6: { category: 'Index Fund', isIndex: true },
    INF204K01XX3: { category: 'Debt Fund', isIndex: false },
  }

  it('accepts a valid draft', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 25 },
        { schemeCode: 'INF740K01QQ4', percentage: 25 },
        { schemeCode: 'INF204K01XX3', percentage: 25 },
        { schemeCode: 'INF769K01EW6', percentage: 25 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a draft whose allocations do not sum to 100%', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 60 },
        { schemeCode: 'INF740K01QQ4', percentage: 30 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('sum to 90%'))).toBe(true)
  })

  it('rejects duplicate scheme codes', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 70 },
        { schemeCode: 'INF209K01UN8', percentage: 30 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Duplicate scheme codes'))).toBe(true)
  })

  it('rejects references to unknown scheme codes', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 50 },
        { schemeCode: 'UNKNOWN001', percentage: 50 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Unknown scheme codes'))).toBe(true)
  })

  it('rejects category weights outside configured bounds', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 80 },
        { schemeCode: 'INF204K01XX3', percentage: 20 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, {
      categoryBounds: { 'large cap fund': { max: 60 } },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('large cap') && e.includes('above maximum'))).toBe(true)
  })

  it('rejects a single non-index fund above the concentration cap', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 80 },
        { schemeCode: 'INF204K01XX3', percentage: 20 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('exceeds single-fund cap'))).toBe(true)
  })

  it('allows index funds to exceed the single-fund cap', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF769K01EW6', percentage: 80 },
        { schemeCode: 'INF204K01XX3', percentage: 20 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(true)
  })

  it('treats ETFs as index-fund exempt by category name', () => {
    const etfUniverse: Record<string, FundSnapshot> = {
      ETF001: { category: 'Gold ETF' },
      DEBT01: { category: 'Debt Fund' },
    }
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'ETF001', percentage: 80 },
        { schemeCode: 'DEBT01', percentage: 20 },
      ],
    }
    const result = validatePortfolioDraft(draft, etfUniverse)
    expect(result.valid).toBe(true)
  })

  it('normalizes allocations when autoNormalize is enabled', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 24.9 },
        { schemeCode: 'INF740K01QQ4', percentage: 24.9 },
        { schemeCode: 'INF204K01XX3', percentage: 24.9 },
        { schemeCode: 'INF769K01EW6', percentage: 24.9 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { autoNormalize: true })
    expect(result.valid).toBe(true)
    expect(result.normalized).toBeDefined()
    const total = result.normalized!.allocations.reduce((s, a) => s + a.percentage, 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it('does not normalize a perfectly balanced draft', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 25 },
        { schemeCode: 'INF740K01QQ4', percentage: 25 },
        { schemeCode: 'INF204K01XX3', percentage: 25 },
        { schemeCode: 'INF769K01EW6', percentage: 25 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { autoNormalize: true })
    expect(result.valid).toBe(true)
    expect(result.normalized).toBeUndefined()
  })

  it('rejects negative allocations', () => {
    const draft: PortfolioDraft = {
      allocations: [{ schemeCode: 'INF209K01UN8', percentage: -10 }],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('negative'))).toBe(true)
  })

  it('rejects an empty draft', () => {
    const result = validatePortfolioDraft({ allocations: [] }, universe)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('no allocations')
  })
})
