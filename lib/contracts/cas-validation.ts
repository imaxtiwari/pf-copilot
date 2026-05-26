export type CASHolding = {
  folio_number: string
  scheme_name: string
  units: number
  nav: number
  market_value: number
  scheme_code?: string | null
}

export type CASExtraction = {
  source: 'NSDL' | 'CDSL'
  as_of_date: string       // YYYY-MM-DD
  total_value_reported: number
  holdings: CASHolding[]
  _extraction_notes?: string[]
}

export type ValidationResult =
  | { ok: true; extraction: CASExtraction }
  | { ok: false; errors: string[] }

const NAV_TOLERANCE = 0.5    // ±₹0.50 per holding
const TOTAL_TOLERANCE = 0.01 // ±1% of total

// Guards against NaN, Infinity, and non-positive values that slip past falsy checks
function isValidPositiveNumber(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n) && n > 0
}

// market_value may legitimately be 0 for a fully-liquidated fund
function isValidNonNegativeNumber(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n) && n >= 0
}

export function validateCAS(extraction: CASExtraction): ValidationResult {
  const errors: string[] = []

  if (!extraction.holdings || extraction.holdings.length === 0) {
    return { ok: false, errors: ['Holdings array is empty'] }
  }

  // Compare both sides as UTC midnight so a CAS dated "today" in IST (UTC+5:30)
  // is never rejected as "future" when the server clock hasn't yet crossed midnight UTC.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const asOf = new Date(extraction.as_of_date + 'T00:00:00Z') // explicit UTC midnight
  if (isNaN(asOf.getTime())) {
    errors.push(`Invalid as_of_date: "${extraction.as_of_date}"`)
  } else if (asOf > today) {
    errors.push(`as_of_date ${extraction.as_of_date} is in the future`)
  }

  let computedTotal = 0
  for (const h of extraction.holdings) {
    if (!isValidPositiveNumber(h.units) || !isValidPositiveNumber(h.nav) || !isValidNonNegativeNumber(h.market_value)) {
      errors.push(`${h.scheme_name}: units or nav is zero/NaN/Infinity, or market_value is NaN/Infinity`)
      continue
    }
    const expected = h.units * h.nav
    if (Math.abs(expected - h.market_value) > NAV_TOLERANCE) {
      errors.push(
        `${h.scheme_name}: units×nav=${expected.toFixed(2)} but market_value=${h.market_value} (diff ${Math.abs(expected - h.market_value).toFixed(2)} > ${NAV_TOLERANCE})`,
      )
    }
    computedTotal += h.market_value
  }

  if (extraction.total_value_reported > 0) {
    const pct = Math.abs(computedTotal - extraction.total_value_reported) / extraction.total_value_reported
    if (pct > TOTAL_TOLERANCE) {
      errors.push(
        `Portfolio total mismatch: reported=${extraction.total_value_reported} computed=${computedTotal.toFixed(2)} (${(pct * 100).toFixed(2)}% > 1%)`,
      )
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, extraction }
}
