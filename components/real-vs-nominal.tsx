// No forbidden words: buy / sell / should / recommend / best fund / good fund / bad fund / top pick

type PortfolioSummary = {
  total_value: number
  weighted_nominal_return_1y: number | null
  weighted_real_return_1y: number | null
  personal_inflation_rate: number
}

function pct(val: number | null, decimals = 2): string {
  if (val === null) return '—'
  return `${(val * 100).toFixed(decimals)}%`
}

function returnColor(val: number | null): string {
  if (val === null) return 'text-gray-400'
  if (val < 0) return 'text-red-600'
  if (val < 0.03) return 'text-orange-500'
  return 'text-emerald-600'
}

export function RealVsNominal({
  portfolio,
  inflationConfidence = 'medium',
}: {
  portfolio: PortfolioSummary
  inflationConfidence?: 'low' | 'medium' | 'high'
}) {
  const { weighted_nominal_return_1y, weighted_real_return_1y, personal_inflation_rate } = portfolio

  const inflationEaten =
    weighted_nominal_return_1y !== null && weighted_real_return_1y !== null
      ? weighted_nominal_return_1y - weighted_real_return_1y
      : null

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
      {/* Returns split */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-around">
        {/* Nominal */}
        <div className="text-center">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Nominal 1-yr return
          </p>
          <p className={`text-5xl font-extrabold tabular-nums ${returnColor(weighted_nominal_return_1y)}`}>
            {pct(weighted_nominal_return_1y)}
          </p>
          <p className="mt-1 text-xs text-gray-400">What the factsheet shows</p>
        </div>

        {/* Arrow + inflation label */}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="hidden h-px w-16 bg-gray-200 sm:block" />
          <div className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
            − {pct(personal_inflation_rate)} inflation
            {inflationConfidence === 'low' && (
              <span className="ml-1 text-orange-400">(est.)</span>
            )}
          </div>
          <div className="hidden h-px w-16 bg-gray-200 sm:block" />
        </div>

        {/* Real */}
        <div className="text-center">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Real return
          </p>
          <p className={`text-5xl font-extrabold tabular-nums ${returnColor(weighted_real_return_1y)}`}>
            {pct(weighted_real_return_1y)}
          </p>
          <p className="mt-1 text-xs text-gray-400">Purchasing-power gain</p>
        </div>
      </div>

      {/* Explanation */}
      <p className="mt-5 text-center text-sm text-gray-600">
        {inflationEaten !== null ? (
          <>
            Inflation accounts for{' '}
            <span className="font-semibold text-orange-600">{pct(inflationEaten)}</span> of your
            nominal return. Real return is what actually grows your purchasing power — the number
            that matters for long-term goals like retirement or a house.
          </>
        ) : (
          <>
            Real return = what actually grows your purchasing power after accounting for your
            personal inflation rate ({pct(personal_inflation_rate)}).
          </>
        )}
      </p>

      {inflationConfidence === 'low' && (
        <p className="mt-3 text-center text-xs text-gray-400">
          * Inflation estimate is based on default assumptions — complete your onboarding profile
          for a personalised rate.
        </p>
      )}
    </div>
  )
}
