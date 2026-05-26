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
  return (1 + nominal) / (1 + inflation) - 1
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

  const weighted_nominal_return_1y =
    weightedBase > 0
      ? round4(withData.reduce((s, h) => s + h.nominal_return_1y! * h.market_value, 0) / weightedBase)
      : null

  // Pass full-precision weighted nominal into Fisher to avoid double-rounding;
  // round only the final portfolio real return value.
  const weighted_real_return_1y =
    weighted_nominal_return_1y !== null
      ? round4(fisherReal(weighted_nominal_return_1y, inflationRate))
      : null

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
