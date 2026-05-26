import type { PerHoldingResult } from '@/lib/inflation/real-returns'

function fmtInr(val: number): string {
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function fmtPct(val: number | null): string {
  if (val === null) return '—'
  return `${(val * 100).toFixed(2)}%`
}

function returnBadge(val: number | null): React.ReactNode {
  if (val === null)
    return <span className="text-gray-400">—</span>
  const color =
    val < 0
      ? 'text-red-600 bg-red-50'
      : val < 0.03
      ? 'text-orange-600 bg-orange-50'
      : 'text-emerald-700 bg-emerald-50'
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${color}`}>
      {fmtPct(val)}
    </span>
  )
}

export function PortfolioTable({ perHolding }: { perHolding: PerHoldingResult[] }) {
  if (perHolding.length === 0) return null

  const total = perHolding.reduce((s, h) => s + h.market_value, 0)

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Scheme</th>
              <th className="px-4 py-3 text-right">Value (₹)</th>
              <th className="px-4 py-3 text-right">Wt.</th>
              <th className="px-4 py-3 text-right">Nominal 1yr</th>
              <th className="px-4 py-3 text-right">Real 1yr</th>
              <th className="px-4 py-3 text-right">Factsheet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {perHolding.map((h, i) => {
              const weight = total > 0 ? (h.market_value / total) * 100 : 0
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="max-w-xs px-4 py-3">
                    <span className="line-clamp-2 font-medium leading-snug text-gray-900">
                      {h.scheme_name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {fmtInr(h.market_value)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">
                    {weight.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right">{returnBadge(h.nominal_return_1y)}</td>
                  <td className="px-4 py-3 text-right">{returnBadge(h.real_return_1y)}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">
                    {h.factsheet_date ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* Total row */}
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td className="px-4 py-2.5 text-sm font-semibold text-gray-700">Total</td>
              <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-900">
                {fmtInr(total)}
              </td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
