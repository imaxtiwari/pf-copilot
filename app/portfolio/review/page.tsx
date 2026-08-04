'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type ConfidenceLevel = 'high' | 'medium' | 'low'

type Confidence = {
    source: 'text' | 'vision'
    dateConfidence: ConfidenceLevel
    mathCheckConfidence: ConfidenceLevel
    schemeMatchConfidence: ConfidenceLevel
    overallConfidence: ConfidenceLevel
}

type HoldingDraft = {
    folio_number: string
    scheme_name: string
    units: number
    nav: number
    market_value: number
    scheme_code?: string | null
}

type Extraction = {
    source: 'NSDL' | 'CDSL'
    as_of_date: string
    total_value_reported: number
    holdings: HoldingDraft[]
}

type ReviewState =
    | { status: 'loading' }
    | { status: 'ready'; extraction: Extraction; thumbnails: string[]; confidence: Confidence; unmatched: string[]; hash: string }
    | { status: 'saving' }
    | { status: 'saved' }
    | { status: 'error'; message: string }

function confidenceBadge(level: ConfidenceLevel) {
    const classes = {
        high: 'bg-green-100 text-green-800',
        medium: 'bg-yellow-100 text-yellow-800',
        low: 'bg-red-100 text-red-800',
    }
    return (
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${classes[level]}`}>
            {level}
        </span>
    )
}

export default function ReviewPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [state, setState] = useState<ReviewState>({ status: 'loading' })

    useEffect(() => {
        const extractionParam = searchParams.get('extraction')
        const thumbnailsParam = searchParams.get('thumbnails')
        const confidenceParam = searchParams.get('confidence')
        const unmatchedParam = searchParams.get('unmatched')
        const hashParam = searchParams.get('hash')

        if (!extractionParam || !confidenceParam || !hashParam) {
            setState({ status: 'error', message: 'Missing review session data.' })
            return
        }

        try {
            setState({
                status: 'ready',
                extraction: JSON.parse(decodeURIComponent(extractionParam)),
                thumbnails: thumbnailsParam ? JSON.parse(decodeURIComponent(thumbnailsParam)) : [],
                confidence: JSON.parse(decodeURIComponent(confidenceParam)),
                unmatched: unmatchedParam ? JSON.parse(decodeURIComponent(unmatchedParam)) : [],
                hash: decodeURIComponent(hashParam),
            })
        } catch {
            setState({ status: 'error', message: 'Invalid review session data.' })
        }
    }, [searchParams])

    function updateHolding(index: number, field: keyof HoldingDraft, value: string) {
        if (state.status !== 'ready') return
        const next = { ...state }
        const holdings = [...next.extraction.holdings]
        const holding = { ...holdings[index] }

        if (field === 'scheme_name' || field === 'folio_number' || field === 'scheme_code') {
            holding[field] = value
        } else {
            const num = parseFloat(value)
            holding[field] = isNaN(num) ? 0 : num
        }

        holdings[index] = holding
        next.extraction = { ...next.extraction, holdings }
        setState(next)
    }

    async function handleConfirm() {
        if (state.status !== 'ready') return
        setState({ status: 'saving' })

        try {
            const res = await fetch('/api/cas/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: state.extraction.source,
                    as_of_date: state.extraction.as_of_date,
                    total_value_reported: state.extraction.total_value_reported,
                    holdings: state.extraction.holdings,
                    hash: state.hash,
                }),
            })
            const json = await res.json()
            if (json.ok) {
                setState({ status: 'saved' })
                setTimeout(() => router.push('/portfolio'), 1500)
            } else {
                setState({ status: 'error', message: json.error?.message ?? 'Could not save holdings.' })
            }
        } catch {
            setState({ status: 'error', message: 'Network error. Please try again.' })
        }
    }

    if (state.status === 'loading') {
        return (
            <main className="mx-auto max-w-5xl px-4 py-10">
                <p className="text-sm text-gray-500">Loading review session…</p>
            </main>
        )
    }

    if (state.status === 'saving') {
        return (
            <main className="mx-auto max-w-5xl px-4 py-10">
                <p className="text-sm text-gray-500">Saving holdings…</p>
            </main>
        )
    }

    if (state.status === 'saved') {
        return (
            <main className="mx-auto max-w-5xl px-4 py-10">
                <div className="rounded bg-green-50 px-4 py-3 text-sm text-green-800">
                    Holdings saved. Redirecting to portfolio…
                </div>
            </main>
        )
    }

    if (state.status === 'error') {
        return (
            <main className="mx-auto max-w-5xl px-4 py-10">
                <div className="rounded bg-red-50 px-4 py-3 text-sm text-red-800">
                    {state.message}
                </div>
                <div className="mt-4">
                    <Link href="/portfolio/upload" className="text-sm text-indigo-600 hover:underline">
                        ← Back to upload
                    </Link>
                </div>
            </main>
        )
    }

    const { extraction, thumbnails, confidence, unmatched } = state
    const computedTotal = extraction.holdings.reduce((s, h) => s + h.market_value, 0)

    return (
        <main className="mx-auto max-w-5xl px-4 py-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Review CAS extraction</h1>
                    <p className="text-sm text-gray-500">
                        Please verify the extracted holdings before saving. Low-confidence fields are highlighted.
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-xs text-gray-500">Overall confidence</div>
                    {confidenceBadge(confidence.overallConfidence)}
                </div>
            </div>

            <div className="mb-4 rounded border bg-white p-4 text-sm">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                        <span className="text-gray-500">Source</span>
                        <div className="font-medium uppercase">{confidence.source}</div>
                    </div>
                    <div>
                        <span className="text-gray-500">As of date</span>
                        <div className="font-medium">{extraction.as_of_date}</div>
                        {confidence.dateConfidence !== 'high' && (
                            <div className="mt-1">{confidenceBadge(confidence.dateConfidence)}</div>
                        )}
                    </div>
                    <div>
                        <span className="text-gray-500">Math check</span>
                        <div className="mt-1">{confidenceBadge(confidence.mathCheckConfidence)}</div>
                    </div>
                    <div>
                        <span className="text-gray-500">Scheme match</span>
                        <div className="mt-1">{confidenceBadge(confidence.schemeMatchConfidence)}</div>
                    </div>
                </div>
                {unmatched.length > 0 && (
                    <div className="mt-3 rounded bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                        <strong>Unmatched schemes:</strong> {unmatched.join(', ')}
                    </div>
                )}
            </div>

            <div className="mb-6 grid gap-6 lg:grid-cols-[1fr,320px]">
                <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 py-2 text-left">Scheme</th>
                                <th className="px-3 py-2 text-left">Folio</th>
                                <th className="px-3 py-2 text-right">Units</th>
                                <th className="px-3 py-2 text-right">NAV</th>
                                <th className="px-3 py-2 text-right">Value (₹)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {extraction.holdings.map((h, i) => {
                                const expected = h.units * h.nav
                                const diff = Math.abs(expected - h.market_value)
                                const mathLow = diff > 0.5
                                return (
                                    <tr key={i} className={mathLow ? 'bg-red-50' : ''}>
                                        <td className="px-3 py-2">
                                            <input
                                                type="text"
                                                value={h.scheme_name}
                                                onChange={(e) => updateHolding(i, 'scheme_name', e.target.value)}
                                                className="w-full rounded border-gray-300 px-2 py-1 text-sm"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="text"
                                                value={h.folio_number}
                                                onChange={(e) => updateHolding(i, 'folio_number', e.target.value)}
                                                className="w-full rounded border-gray-300 px-2 py-1 text-sm"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="number"
                                                step="0.0001"
                                                value={h.units}
                                                onChange={(e) => updateHolding(i, 'units', e.target.value)}
                                                className="w-24 rounded border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="number"
                                                step="0.0001"
                                                value={h.nav}
                                                onChange={(e) => updateHolding(i, 'nav', e.target.value)}
                                                className="w-24 rounded border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={h.market_value}
                                                onChange={(e) => updateHolding(i, 'market_value', e.target.value)}
                                                className={`w-28 rounded px-2 py-1 text-right text-sm tabular-nums ${mathLow ? 'border-red-400 bg-red-50' : 'border-gray-300'
                                                    }`}
                                            />
                                            {mathLow && (
                                                <p className="mt-1 text-right text-[10px] text-red-600">
                                                    Expected ~₹{expected.toFixed(2)}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div className="border-t bg-gray-50 px-3 py-2 text-right text-sm font-medium">
                        Computed total: ₹{computedTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        {extraction.total_value_reported > 0 && (
                            <span className="ml-3 text-gray-500">
                                Reported: ₹{extraction.total_value_reported.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </span>
                        )}
                    </div>
                </div>

                <aside>
                    <h2 className="mb-2 text-sm font-semibold text-gray-700">PDF pages</h2>
                    {thumbnails.length === 0 ? (
                        <p className="text-sm text-gray-400">Thumbnails not available.</p>
                    ) : (
                        <div className="space-y-3">
                            {thumbnails.map((src, i) => (
                                <div key={i} className="overflow-hidden rounded border">
                                    <img src={src} alt={`Page ${i + 1}`} className="w-full" />
                                    <div className="bg-gray-50 px-2 py-1 text-center text-xs text-gray-500">
                                        Page {i + 1}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            </div>

            <div className="flex items-center gap-4">
                <button
                    onClick={handleConfirm}
                    className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                    Confirm & Save
                </button>
                <Link
                    href="/portfolio/upload"
                    className="rounded-lg border px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                    Cancel
                </Link>
            </div>

            <p className="mt-8 text-xs text-gray-400">
                Educational tool only — not investment advice.
            </p>
        </main>
    )
}
