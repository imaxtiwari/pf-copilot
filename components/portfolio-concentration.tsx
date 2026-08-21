'use client'

function fmtInr(val: number): string {
    return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export type ConcentrationHolding = {
    schemeName: string
    schemeCode: string | null
    marketValue: number
    bucket: string
}

export function PortfolioConcentration({
    holdings,
    totalValue,
}: {
    holdings: ConcentrationHolding[]
    totalValue: number
}) {
    if (holdings.length === 0) {
        return (
            <div className="rounded border bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                No holdings to show.
            </div>
        )
    }

    const top5Weight =
        totalValue > 0
            ? holdings.slice(0, 5).reduce((sum, h) => sum + h.marketValue, 0) / totalValue
            : 0

    let observation = ''
    if (top5Weight >= 0.8) {
        observation = 'Your top 5 holdings make up most of this portfolio.'
    } else if (top5Weight >= 0.5) {
        observation = 'Your top 5 holdings account for about half the portfolio.'
    } else {
        observation = 'Your top 5 holdings are a relatively small share of the portfolio.'
    }

    return (
        <div>
            <p className="mb-3 text-sm text-gray-600">{observation}</p>
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                <th className="px-4 py-3">Holding</th>
                                <th className="px-4 py-3">Bucket</th>
                                <th className="px-4 py-3 text-right">Value</th>
                                <th className="px-4 py-3 text-right">Weight</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {holdings.map((h, i) => {
                                const weight =
                                    totalValue > 0 ? (h.marketValue / totalValue) * 100 : 0
                                return (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="max-w-xs px-4 py-3">
                                            <span className="line-clamp-2 font-medium leading-snug text-gray-900">
                                                {h.schemeName}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-600">
                                            {h.bucket}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                                            {fmtInr(h.marketValue)}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                                            {weight.toFixed(1)}%
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
