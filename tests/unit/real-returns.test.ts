import { describe, it, expect } from 'vitest'
import { computeRealReturns, fisherReal } from '../../lib/inflation/real-returns'
import { parseNominalReturn1y } from '../../lib/inflation/parse-return'

// ── fisherReal unit tests ──────────────────────────────────────────────────────
// fisherReal is full-precision (no internal rounding) — callers round at display layer.

describe('fisherReal', () => {
  it('AC2 spot-check: nominal 14%, inflation 9% → real ≈ 4.59%', () => {
    // (1.14 / 1.09) - 1 = 0.04587155963302752
    expect(fisherReal(0.14, 0.09)).toBeCloseTo(0.0459, 3)
  })

  it('zero inflation: real return equals nominal return exactly', () => {
    expect(fisherReal(0.12, 0.0)).toBeCloseTo(0.12, 10)
  })

  it('zero nominal, zero inflation → real return is 0', () => {
    expect(fisherReal(0, 0)).toBe(0)
  })

  it('equal nominal and inflation → real return is ~0 (not exactly due to floating point)', () => {
    // (1.08 / 1.08) - 1 = 0
    expect(fisherReal(0.08, 0.08)).toBeCloseTo(0, 10)
  })

  it('negative nominal return', () => {
    // (-5% nominal, 8% inflation) → (0.95/1.08) - 1 ≈ -0.1204
    const result = fisherReal(-0.05, 0.08)
    expect(result).toBeLessThan(0)
    expect(result).toBeCloseTo(-0.1204, 3)
  })

  it('inflation higher than nominal → negative real return', () => {
    expect(fisherReal(0.05, 0.08)).toBeLessThan(0)
  })

  it('very high inflation (100%) → real return heavily penalised', () => {
    // nominal 20%, inflation 100% → (1.2 / 2.0) - 1 = -0.4
    expect(fisherReal(0.20, 1.0)).toBeCloseTo(-0.4, 10)
  })
})

// ── computeRealReturns ─────────────────────────────────────────────────────────

const BASE_HOLDING = {
  scheme_code: 'SC001',
  scheme_name: 'Test Fund',
  market_value: 100_000,
  nominal_return_1y: 0.14,
  factsheet_date: '2025-04-30',
}

describe('computeRealReturns — per holding', () => {
  it('AC2 spot-check: single holding, nominal 14%, inflation 9%', () => {
    const result = computeRealReturns([BASE_HOLDING], 0.09)
    expect(result.per_holding[0].real_return_1y).toBe(0.0459)
    expect(result.per_holding[0].nominal_return_1y).toBe(0.14)
  })

  it('AC3 missing nominal data → null per_holding real return (show "—" in UI)', () => {
    const h = { ...BASE_HOLDING, nominal_return_1y: null, factsheet_date: null }
    const result = computeRealReturns([h], 0.09)
    expect(result.per_holding[0].nominal_return_1y).toBeNull()
    expect(result.per_holding[0].real_return_1y).toBeNull()
  })

  it('passes factsheet_date through to per_holding output', () => {
    const result = computeRealReturns([BASE_HOLDING], 0.09)
    expect(result.per_holding[0].factsheet_date).toBe('2025-04-30')
  })
})

describe('computeRealReturns — portfolio weighted returns', () => {
  it('AC4 weighted return weights by market_value', () => {
    const holdings = [
      { ...BASE_HOLDING, scheme_code: 'A', scheme_name: 'Fund A', market_value: 60_000, nominal_return_1y: 0.10 },
      { ...BASE_HOLDING, scheme_code: 'B', scheme_name: 'Fund B', market_value: 40_000, nominal_return_1y: 0.20 },
    ]
    const result = computeRealReturns(holdings, 0.0)
    // weighted nominal = (60000*0.10 + 40000*0.20) / 100000 = 14000/100000 = 0.14
    expect(result.portfolio.weighted_nominal_return_1y).toBe(0.14)
  })

  it('AC6 all holdings missing data → null weighted portfolio returns', () => {
    const noDataHoldings = [
      { ...BASE_HOLDING, scheme_code: 'A', nominal_return_1y: null, factsheet_date: null },
      { ...BASE_HOLDING, scheme_code: 'B', nominal_return_1y: null, factsheet_date: null },
    ]
    const result = computeRealReturns(noDataHoldings, 0.09)
    expect(result.portfolio.weighted_nominal_return_1y).toBeNull()
    expect(result.portfolio.weighted_real_return_1y).toBeNull()
  })

  it('mixed: some with data, some without — weights only over holdings with data', () => {
    const holdings = [
      { ...BASE_HOLDING, scheme_code: 'A', market_value: 80_000, nominal_return_1y: 0.15 },
      { ...BASE_HOLDING, scheme_code: 'B', market_value: 20_000, nominal_return_1y: null, factsheet_date: null },
    ]
    const result = computeRealReturns(holdings, 0.09)
    // Only Fund A has data; weighted nominal = 0.15 (only one holding in the weighted pool)
    expect(result.portfolio.weighted_nominal_return_1y).toBe(0.15)
    expect(result.portfolio.weighted_real_return_1y).not.toBeNull()
  })

  it('portfolio total_value includes all holdings regardless of return data', () => {
    const holdings = [
      { ...BASE_HOLDING, scheme_code: 'A', market_value: 60_000, nominal_return_1y: 0.10 },
      { ...BASE_HOLDING, scheme_code: 'B', market_value: 40_000, nominal_return_1y: null, factsheet_date: null },
    ]
    const result = computeRealReturns(holdings, 0.09)
    expect(result.portfolio.total_value).toBe(100_000)
  })

  it('personal_inflation_rate is passed through unchanged', () => {
    const result = computeRealReturns([BASE_HOLDING], 0.085)
    expect(result.portfolio.personal_inflation_rate).toBe(0.085)
  })
})

// ── parseNominalReturn1y ───────────────────────────────────────────────────────

describe('parseNominalReturn1y', () => {
  it('parses "1 Year Return: 15.23%" → 0.1523', () => {
    expect(parseNominalReturn1y('1 Year Return: 15.23%')).toBeCloseTo(0.1523, 6)
  })

  it('parses "1-Year: 15.23%"', () => {
    expect(parseNominalReturn1y('1-Year: 15.23%')).toBeCloseTo(0.1523, 6)
  })

  it('parses "1Y: 15.23%"', () => {
    expect(parseNominalReturn1y('1Y: 15.23%')).toBeCloseTo(0.1523, 6)
  })

  it('parses "1yr: 15.23%"', () => {
    expect(parseNominalReturn1y('1yr: 15.23%')).toBeCloseTo(0.1523, 6)
  })

  it('parses bare number without % symbol: "1Y: 15.23"', () => {
    expect(parseNominalReturn1y('1Y: 15.23')).toBeCloseTo(0.1523, 6)
  })

  it('parses bare number without % symbol: "1 Year Return: 8.45"', () => {
    expect(parseNominalReturn1y('1 Year Return: 8.45')).toBeCloseTo(0.0845, 6)
  })

  it('parses negative return: "-5.23%"', () => {
    expect(parseNominalReturn1y('1Y: -5.23%')).toBeCloseTo(-0.0523, 6)
  })

  it('returns null for unrecognised text', () => {
    expect(parseNominalReturn1y('No return data available')).toBeNull()
  })

  it('returns null for out-of-range value (>500%)', () => {
    expect(parseNominalReturn1y('1Y: 999.99%')).toBeNull()
  })

  it('returns null for out-of-range value (<-100%)', () => {
    expect(parseNominalReturn1y('1Y: -101%')).toBeNull()
  })

  it('handles surrounding text correctly', () => {
    const chunkText = 'Fund performance data:\n1 Year Return: 22.40%\n3 Year Return: 18.50%'
    expect(parseNominalReturn1y(chunkText)).toBeCloseTo(0.224, 5)
  })
})
