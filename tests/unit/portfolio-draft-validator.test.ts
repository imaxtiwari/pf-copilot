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

  it('rejects NaN allocations', () => {
    const draft: PortfolioDraft = {
      allocations: [{ schemeCode: 'INF209K01UN8', percentage: NaN }],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('not a valid number'))).toBe(true)
  })

  it('rejects allocations exceeding 100% plus tolerance', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 60 },
        { schemeCode: 'INF740K01QQ4', percentage: 50 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('110%'))).toBe(true)
  })

  it('enforces category minimum bounds', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 5 },
        { schemeCode: 'INF204K01XX3', percentage: 95 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, {
      categoryBounds: { 'debt fund': { min: 20 }, 'large cap fund': { min: 10 } },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('large cap') && e.includes('below minimum'))).toBe(true)
  })

  it('rejects a draft with multiple duplicate scheme codes', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 30 },
        { schemeCode: 'INF209K01UN8', percentage: 30 },
        { schemeCode: 'INF740K01QQ4', percentage: 40 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Duplicate scheme codes'))).toBe(true)
  })

  it('rejects multiple unknown scheme codes', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'UNKNOWN001', percentage: 50 },
        { schemeCode: 'UNKNOWN002', percentage: 50 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('UNKNOWN001') && e.includes('UNKNOWN002'))).toBe(true)
  })

  it('allows allocations within tolerance below 100%', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 25 },
        { schemeCode: 'INF740K01QQ4', percentage: 25 },
        { schemeCode: 'INF204K01XX3', percentage: 24.9 },
        { schemeCode: 'INF769K01EW6', percentage: 24.9 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { allocationTolerancePct: 1 })
    expect(result.valid).toBe(true)
  })

  it('normalizes allocations that are slightly off', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF209K01UN8', percentage: 25 },
        { schemeCode: 'INF740K01QQ4', percentage: 25 },
        { schemeCode: 'INF204K01XX3', percentage: 25 },
        { schemeCode: 'INF769K01EW6', percentage: 24.99 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { autoNormalize: true })
    expect(result.valid).toBe(true)
    expect(result.normalized).toBeDefined()
    const normalizedTotal = result.normalized!.allocations.reduce((s, a) => s + a.percentage, 0)
    expect(normalizedTotal).toBeCloseTo(100, 5)
    expect(result.normalized!.allocations[3].percentage).toBeCloseTo(24.9925, 4)
  })

  it('exempts index funds from single-fund cap when enabled', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF769K01EW6', percentage: 95 },
        { schemeCode: 'INF204K01XX3', percentage: 5 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { indexFundConcentrationExemption: true })
    expect(result.valid).toBe(true)
  })

  it('does not exempt index funds when exemption is disabled', () => {
    const draft: PortfolioDraft = {
      allocations: [
        { schemeCode: 'INF769K01EW6', percentage: 95 },
        { schemeCode: 'INF204K01XX3', percentage: 5 },
      ],
    }
    const result = validatePortfolioDraft(draft, universe, { indexFundConcentrationExemption: false })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('exceeds single-fund cap'))).toBe(true)
  })
})
