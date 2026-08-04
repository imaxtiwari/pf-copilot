'use client'

import { useMemo } from 'react'

type Bucket = {
    bucket: string
    value: number
    weight: number
    holdingCount: number
}

const BUCKET_COLORS: Record<string, string> = {
    'Equity - Large Cap': '#4f46e5',
    'Equity - Mid Cap': '#06b6d4',
    'Equity - Small Cap': '#f59e0b',
    'Equity - Multi/ Flexi/ Focused': '#8b5cf6',
    'ELSS (Tax Saver)': '#10b981',
    'Hybrid': '#f97316',
    'Debt': '#64748b',
    'Liquid': '#14b8a6',
    'Other': '#94a3b8',
    'Uncategorized': '#cbd5e1',
}

export function PortfolioAllocationChart({ buckets, totalValue }: { buckets: Bucket[]; totalValue: number }) {
    const chartBuckets = useMemo(() => {
        return [...buckets]
            .filter((b) => b.value > 0)
            .sort((a, b) => b.value - a.value)
    }, [buckets])

    if (chartBuckets.length === 0) {
        return (
            <div className="rounded border bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                No allocation data available.
            </div>
        )
    }

    const size = 200
    const center = size / 2
    const radius = size / 2 - 2
    let currentAngle = -Math.PI / 2

    const slices = chartBuckets.map((b) => {
        const fraction = totalValue > 0 ? b.value / totalValue : 0
        const angle = fraction * Math.PI * 2
        const startAngle = currentAngle
        const endAngle = currentAngle + angle
        currentAngle = endAngle

        const x1 = center + radius * Math.cos(startAngle)
        const y1 = center + radius * Math.sin(startAngle)
        const x2 = center + radius * Math.cos(endAngle)
        const y2 = center + radius * Math.sin(endAngle)
        const largeArc = angle > Math.PI ? 1 : 0
        const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`

        return {
            bucket: b.bucket,
            value: b.value,
            weight: b.weight,
            path,
            color: BUCKET_COLORS[b.bucket] ?? '#94a3b8',
        }
    })

    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48 shrink-0">
                {slices.map((s, i) => (
                    <path
                        key={i}
                        d={s.path}
                        fill={s.color}
                        stroke="white"
                        strokeWidth={2}
                    />
                ))}
                <circle cx={center} cy={center} r={radius * 0.45} fill="white" />
                <text
                    x={center}
                    y={center - 4}
                    textAnchor="middle"
                    className="fill-gray-900 text-[10px] font-semibold"
                >
                    ₹{(totalValue / 1000).toFixed(0)}k
                </text>
                <text
                    x={center}
                    y={center + 10}
                    textAnchor="middle"
                    className="fill-gray-500 text-[8px]"
                >
                    total
                </text>
            </svg>

            <div className="flex-1">
                <div className="grid grid-cols-1 gap-2 text-sm">
                    {chartBuckets.map((b) => (
                        <div key={b.bucket} className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <span
                                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: BUCKET_COLORS[b.bucket] ?? '#94a3b8' }}
                                />
                                <span className="truncate text-gray-700">{b.bucket}</span>
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                                <span className="font-medium text-gray-900">{(b.weight * 100).toFixed(1)}%</span>
                                <span className="ml-2 text-xs text-gray-400">
                                    ₹{b.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
