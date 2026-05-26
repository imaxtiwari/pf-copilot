// ── types ─────────────────────────────────────────────────────────────────────

export type HoldingInput = {
  scheme_code: string | null
  scheme_name: string
  market_value: number
  /** Fraction (e.g. 0.1423 for 14.23%). null when no factsheet data available. */
  nominal_return_1y: number | null
  /** ISO date of the factsheet chunk used — passes through for display. */
  factsheet_date: string | null
}

export type PerHoldingResult = {
  scheme_name: string
  market_value: number
  nominal_return_1y: number | null
  real_return_1y: number | null
  factsheet_date: string | null
}

export type RealReturnsResult = {
  per_holding: PerHoldingResult[]
  portfolio: {
    total_value: number
    /** Weighted only over holdings that have factsheet return data; null if none do. */
    weighted_nominal_return_1y: number | null
    weighted_real_return_1y: number | null
    personal_inflation_rate: number
  }
}

// ── core formula ──────────────────────────────────────────────────────────────

/**
 * Fisher equation: real = (1 + nominal) / (1 + inflation) − 1
 * Returns full-precision — callers are responsible for rounding at display boundaries.
 * Keeping this pure avoids double-rounding when the result is used in further arithmetic
 * (e.g. computing a weighted portfolio real return).
 */
export function fisherReal(nominal: number, inflation: number): number {
  if (inflation <= -1) {
    // Division by zero or negative denominator — deflation beyond 100% is
    // economically undefined; return Infinity as a sentinel rather than NaN.
    return inflation === -1 ? Infinity : NaN
  }
  return Math.round(((1 + nominal) / (1 + inflation) - 1) * 10000) / 10000
}

// ── pure computation ──────────────────────────────────────────────────────────

export function computeRealReturns(
  holdings: HoldingInput[],
  inflationRate: number,
): RealReturnsResult {
  const round4 = (n: number) => Math.round(n * 10000) / 10000

  const per_holding: PerHoldingResult[] = holdings.map((h) => ({
    scheme_name: h.scheme_name,
    market_value: h.market_value,
    nominal_return_1y: h.nominal_return_1y,
    real_return_1y:
      h.nominal_return_1y !== null ? round4(fisherReal(h.nominal_return_1y, inflationRate)) : null,
    factsheet_date: h.factsheet_date,
  }))

  const total_value = holdings.reduce((s, h) => s + h.market_value, 0)

  // Weighted average — only over holdings that have return data
  const withData = per_holding.filter((h) => h.nominal_return_1y !== null)
  const weightedBase = withData.reduce((s, h) => s + h.market_value, 0)

  const rawWeightedNominal =
    weightedBase > 0
      ? withData.reduce((s, h) => s + h.nominal_return_1y! * h.market_value, 0) / weightedBase
      : null

  const weighted_nominal_return_1y =
    rawWeightedNominal !== null ? Math.round(rawWeightedNominal * 10000) / 10000 : null

  // Use the unrounded value for Fisher to avoid compounding rounding error
  const weighted_real_return_1y =
    rawWeightedNominal !== null ? fisherReal(rawWeightedNominal, inflationRate) : null

  return {
    per_holding,
    portfolio: {
      total_value,
      weighted_nominal_return_1y,
      weighted_real_return_1y,
      personal_inflation_rate: inflationRate,
    },
  }
}
