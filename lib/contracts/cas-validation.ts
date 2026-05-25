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

export function validateCAS(extraction: CASExtraction): ValidationResult {
  const errors: string[] = []

  if (!extraction.holdings || extraction.holdings.length === 0) {
    return { ok: false, errors: ['Holdings array is empty'] }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const asOf = new Date(extraction.as_of_date)
  if (isNaN(asOf.getTime())) {
    errors.push(`Invalid as_of_date: "${extraction.as_of_date}"`)
  } else if (asOf > today) {
    errors.push(`as_of_date ${extraction.as_of_date} is in the future`)
  }

  let computedTotal = 0
  for (const h of extraction.holdings) {
    if (!h.units || !h.nav || !h.market_value) {
      errors.push(`${h.scheme_name}: units, nav, or market_value is zero/missing`)
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
