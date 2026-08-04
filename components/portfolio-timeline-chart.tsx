'use client'

type TimelinePoint = {
    as_of_date: string
    total_value: number
    real_return_annualized: number | null
}

export function PortfolioTimelineChart({ data }: { data: TimelinePoint[] }) {
    if (data.length < 2) {
        return (
            <div className="rounded border bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                Upload another CAS to see your portfolio timeline.
            </div>
        )
    }

    const width = 600
    const height = 240
    const padding = { top: 16, right: 16, bottom: 40, left: 64 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    const dates = data.map((d) => new Date(d.as_of_date).getTime())
    const minDate = Math.min(...dates)
    const maxDate = Math.max(...dates)
    const values = data.map((d) => d.total_value)
    const maxValue = Math.max(...values) * 1.05

    const xScale = (timestamp: number) =>
        padding.left + ((timestamp - minDate) / (maxDate - minDate)) * chartWidth
    const yScale = (value: number) => padding.top + chartHeight - (value / maxValue) * chartHeight

    const pathPoints = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(dates[i])} ${yScale(d.total_value)}`).join(' ')

    const formatCurrency = (n: number) => `₹${(n / 1000).toFixed(0)}k`
    const formatDate = (d: string) =>
        new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

    return (
        <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[600px]">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                    const y = padding.top + chartHeight * pct
                    return (
                        <line
                            key={pct}
                            x1={padding.left}
                            y1={y}
                            x2={width - padding.right}
                            y2={y}
                            stroke="#e5e7eb"
                            strokeDasharray="4"
                        />
                    )
                })}

                {/* Y-axis labels */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                    const value = maxValue * (1 - pct)
                    const y = padding.top + chartHeight * pct
                    return (
                        <text key={pct} x={padding.left - 8} y={y + 4} textAnchor="end" className="text-[10px] fill-gray-500">
                            {formatCurrency(value)}
                        </text>
                    )
                })}

                {/* X-axis labels */}
                {data.map((d, i) => (
                    <text
                        key={i}
                        x={xScale(dates[i])}
                        y={height - 12}
                        textAnchor="middle"
                        className="text-[10px] fill-gray-500"
                    >
                        {formatDate(d.as_of_date)}
                    </text>
                ))}

                {/* Line */}
                <path d={pathPoints} fill="none" stroke="#4f46e5" strokeWidth={2} />

                {/* Dots */}
                {data.map((d, i) => (
                    <circle
                        key={i}
                        cx={xScale(dates[i])}
                        cy={yScale(d.total_value)}
                        r={4}
                        fill="#4f46e5"
                        stroke="white"
                        strokeWidth={2}
                    />
                ))}
            </svg>
        </div>
    )
}
