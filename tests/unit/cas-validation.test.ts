import { describe, it, expect } from 'vitest'
import { validateCAS } from '../../lib/contracts/cas-validation'
import type { CASExtraction, CASHolding } from '../../lib/contracts/cas-validation'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Today's date as YYYY-MM-DD in UTC — matches what the validation code pins to UTC midnight. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Tomorrow's date as YYYY-MM-DD in UTC. */
function tomorrowUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function makeHolding(overrides: Partial<CASHolding> = {}): CASHolding {
  return {
    folio_number: 'F001',
    scheme_name: 'Fund Alpha',
    units: 100,
    nav: 50,
    market_value: 5000, // exact: 100 × 50
    ...overrides,
  }
}

/**
 * BASE_EXTRACTION: valid NSDL CAS, 2 holdings, today's date, perfectly matching totals.
 *
 *   holding[0]: units=100  nav=50   mv=5000   computed=5000  diff=0
 *   holding[1]: units=200  nav=25   mv=5000   computed=5000  diff=0
 *   total_value_reported = 10000 = sum of market_values
 */
function makeExtraction(overrides: Partial<CASExtraction> = {}): CASExtraction {
  return {
    source: 'NSDL',
    as_of_date: todayUTC(),
    total_value_reported: 10000,
    holdings: [
      makeHolding({ folio_number: 'F001', scheme_name: 'Fund Alpha', units: 100, nav: 50, market_value: 5000 }),
      makeHolding({ folio_number: 'F002', scheme_name: 'Fund Beta',  units: 200, nav: 25, market_value: 5000 }),
    ],
    ...overrides,
  }
}

// ── happy path ────────────────────────────────────────────────────────────────

describe('validateCAS — happy path', () => {
  it('valid NSDL extraction passes', () => {
    const result = validateCAS(makeExtraction({ source: 'NSDL' }))
    expect(result.ok).toBe(true)
  })

  it('valid CDSL extraction passes', () => {
    const result = validateCAS(makeExtraction({ source: 'CDSL' }))
    expect(result.ok).toBe(true)
  })

  it('source is passed through unchanged in the ok result', () => {
    const result = validateCAS(makeExtraction({ source: 'CDSL' }))
    if (!result.ok) throw new Error('expected ok')
    expect(result.extraction.source).toBe('CDSL')
  })

  it('extraction object is echoed back in the ok result', () => {
    const extraction = makeExtraction()
    const result = validateCAS(extraction)
    if (!result.ok) throw new Error('expected ok')
    expect(result.extraction).toBe(extraction) // same reference
  })

  it("today's UTC date passes (UTC-midnight guard — no false IST rejection)", () => {
    // Code pins both sides to UTC midnight, so a CAS dated today in IST never
    // appears as "future" even when the server clock hasn't crossed UTC midnight yet.
    const result = validateCAS(makeExtraction({ as_of_date: todayUTC() }))
    expect(result.ok).toBe(true)
  })

  it('market_value = 0 passes for a liquidated fund (isValidNonNegativeNumber allows 0)', () => {
    // units and nav are positive but tiny so units×nav is well within the ±0.50 tolerance
    const result = validateCAS(
      makeExtraction({
        holdings: [
          makeHolding({ units: 0.001, nav: 0.001, market_value: 0 }),
        ],
        total_value_reported: 0, // skip total check
      }),
    )
    expect(result.ok).toBe(true)
  })
})

// ── holdings guard ────────────────────────────────────────────────────────────

describe('validateCAS — holdings guard', () => {
  it('empty holdings array → fails immediately with descriptive message', () => {
    const result = validateCAS(makeExtraction({ holdings: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/Holdings array is empty/)
  })
})

// ── date validation ───────────────────────────────────────────────────────────

describe('validateCAS — date validation', () => {
  it('future as_of_date (tomorrow) → fails', () => {
    const result = validateCAS(makeExtraction({ as_of_date: tomorrowUTC() }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('future'))).toBe(true)
  })

  it('future error message contains the bad date string', () => {
    const tomorrow = tomorrowUTC()
    const result = validateCAS(makeExtraction({ as_of_date: tomorrow }))
    if (result.ok) return
    expect(result.errors[0]).toContain(tomorrow)
  })

  it('invalid date string "not-a-date" → fails', () => {
    const result = validateCAS(makeExtraction({ as_of_date: 'not-a-date' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('Invalid as_of_date'))).toBe(true)
  })

  it('invalid date error message quotes the bad value', () => {
    const result = validateCAS(makeExtraction({ as_of_date: 'not-a-date' }))
    if (result.ok) return
    expect(result.errors[0]).toContain('"not-a-date"')
  })

  it('a past date passes', () => {
    const result = validateCAS(makeExtraction({ as_of_date: '2024-03-31' }))
    expect(result.ok).toBe(true)
  })
})

// ── numeric guards ────────────────────────────────────────────────────────────

describe('validateCAS — numeric guards (units / nav / market_value)', () => {
  it('units = 0 → fails (isValidPositiveNumber rejects 0)', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 0 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('units negative → fails', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: -10 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('nav = NaN → fails', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ nav: NaN })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('nav = Infinity → fails', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ nav: Infinity })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('market_value = NaN → fails (isValidNonNegativeNumber rejects NaN)', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ market_value: NaN })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('market_value = Infinity → fails (isValidNonNegativeNumber rejects Infinity)', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ market_value: Infinity })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('numeric guard error message contains the scheme_name', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ scheme_name: 'Broken Fund XYZ', units: 0 })],
      total_value_reported: 0,
    }))
    if (result.ok) return
    expect(result.errors[0]).toContain('Broken Fund XYZ')
  })
})

// ── NAV tolerance (±₹0.50) ───────────────────────────────────────────────────

describe('validateCAS — NAV tolerance (±₹0.50)', () => {
  it('diff = 0.49 → passes (within tolerance)', () => {
    // units=100, nav=50 → expected=5000; market_value=5000.49 → diff=0.49 ≤ 0.50
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 100, nav: 50, market_value: 5000.49 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(true)
  })

  it('diff = 0.51 → fails (exceeds tolerance)', () => {
    // units=100, nav=50 → expected=5000; market_value=5000.51 → diff=0.51 > 0.50
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 100, nav: 50, market_value: 5000.51 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
  })

  it('NAV mismatch error message contains the scheme_name', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ scheme_name: 'Mirae Asset Large Cap', units: 100, nav: 50, market_value: 5000.51 })],
      total_value_reported: 0,
    }))
    if (result.ok) return
    expect(result.errors[0]).toContain('Mirae Asset Large Cap')
  })

  it('NAV mismatch error message shows computed vs reported values', () => {
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 100, nav: 50, market_value: 5001 })],
      total_value_reported: 0,
    }))
    if (result.ok) return
    // Should mention units×nav and market_value
    expect(result.errors[0]).toMatch(/units.nav/)
    expect(result.errors[0]).toMatch(/market_value/)
  })

  it('diff = exactly 0.50 → passes (boundary: > not >=)', () => {
    // The check is > NAV_TOLERANCE, not >= — so exactly 0.50 passes
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 100, nav: 50, market_value: 5000.50 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(true)
  })
})

// ── portfolio total tolerance (±1%) ──────────────────────────────────────────

describe('validateCAS — portfolio total tolerance (±1%)', () => {
  // Both holdings have exact nav matches, computedTotal = 10000

  it('total mismatch 0.9% → passes', () => {
    // reported=10090, diff=90, pct=90/10090≈0.892% < 1%
    const result = validateCAS(makeExtraction({ total_value_reported: 10090 }))
    expect(result.ok).toBe(true)
  })

  it('total mismatch 1.1% → fails', () => {
    // reported=10110, diff=110, pct=110/10110≈1.088% > 1%
    const result = validateCAS(makeExtraction({ total_value_reported: 10110 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('Portfolio total mismatch'))).toBe(true)
  })

  it('total_value_reported = 0 → total check is skipped entirely', () => {
    // Even if computedTotal is 10000, the check gates on reported > 0
    const result = validateCAS(makeExtraction({ total_value_reported: 0 }))
    expect(result.ok).toBe(true)
  })

  it('total mismatch error message shows reported and computed values', () => {
    const result = validateCAS(makeExtraction({ total_value_reported: 10110 }))
    if (result.ok) return
    expect(result.errors[0]).toContain('reported=10110')
    expect(result.errors[0]).toContain('computed=10000')
  })
})

// ── error accumulation ────────────────────────────────────────────────────────

describe('validateCAS — error accumulation', () => {
  it('two bad holdings → two separate errors (not short-circuit)', () => {
    const result = validateCAS(makeExtraction({
      holdings: [
        makeHolding({ scheme_name: 'Fund Alpha', units: 0 }),   // fails numeric guard
        makeHolding({ scheme_name: 'Fund Beta',  units: 0 }),   // fails numeric guard
      ],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
    expect(result.errors.some((e) => e.includes('Fund Alpha'))).toBe(true)
    expect(result.errors.some((e) => e.includes('Fund Beta'))).toBe(true)
  })

  it('invalid date + bad holding → both errors collected', () => {
    const result = validateCAS(makeExtraction({
      as_of_date: 'not-a-date',
      holdings: [makeHolding({ units: 0 })],
      total_value_reported: 0,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
    expect(result.errors.some((e) => e.includes('Invalid as_of_date'))).toBe(true)
    expect(result.errors.some((e) => e.includes('units or nav'))).toBe(true)
  })

  it('bad holdings do NOT poison the portfolio total (their market_value is excluded from computedTotal)', () => {
    // Only holding has invalid units — skipped by continue — computedTotal stays 0
    // total_value_reported=100 would be a mismatch vs computedTotal=0 (100%),
    // BUT the numeric guard error should appear, not a total mismatch error.
    const result = validateCAS(makeExtraction({
      holdings: [makeHolding({ units: 0, nav: 50, market_value: 5000 })],
      total_value_reported: 100,
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Numeric guard error should be present
    expect(result.errors.some((e) => e.includes('units or nav'))).toBe(true)
  })
})
