'use client'

import Link from 'next/link'
import { useEffect, useState, type ChangeEvent } from 'react'

type Holding = {
    id: string
    isin: string
    companyName: string
    quantity: string
    price: string
    value: string
    asOfDate: string
    source: string
}

type UploadState =
    | { status: 'idle' }
    | { status: 'uploading' }
    | { status: 'success'; holdingsCount: number; fromCache?: boolean }
    | { status: 'error'; message: string; details?: unknown }

export default function EquityPage() {
    const [holdings, setHoldings] = useState<Holding[]>([])
    const [loading, setLoading] = useState(true)
    const [upload, setUpload] = useState<UploadState>({ status: 'idle' })

    async function fetchHoldings() {
        setLoading(true)
        try {
            const res = await fetch('/api/portfolio/equity')
            const json = await res.json()
            if (json.ok) setHoldings(json.data.holdings)
        } catch {
            // ignore
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void fetchHoldings()
    }, [])

    async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        if (file.type !== 'application/pdf') {
            setUpload({ status: 'error', message: 'Only PDF files are accepted.' })
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            setUpload({ status: 'error', message: 'File must be under 10 MB.' })
            return
        }

        setUpload({ status: 'uploading' })
        const form = new FormData()
        form.append('file', file)

        try {
            const res = await fetch('/api/demat/ingest', { method: 'POST', body: form })
            const json = await res.json()
            if (json.ok) {
                setUpload({ status: 'success', holdingsCount: json.data.holdings_count, fromCache: json.data.from_cache })
                fetchHoldings()
            } else {
                setUpload({ status: 'error', message: json.error?.message ?? 'Upload failed.', details: json.error?.details })
            }
        } catch {
            setUpload({ status: 'error', message: 'Network error. Please try again.' })
        } finally {
            if (e.target) e.target.value = ''
        }
    }

    const totalValue = holdings.reduce((s, h) => s + parseFloat(h.value || '0'), 0)

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Equity holdings</h1>
                    <p className="text-sm text-gray-500">
                        {holdings.length} holding{holdings.length !== 1 ? 's' : ''} ·{' '}
                        Total{' '}
                        <span className="font-semibold text-gray-800">
                            ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                    </p>
                </div>
                <Link href="/portfolio" className="text-sm text-indigo-600 underline-offset-2 hover:underline">
                    ← Mutual funds
                </Link>
            </div>

            <section className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
                <h2 className="mb-1 text-base font-semibold">Upload demat statement</h2>
                <p className="mb-4 text-sm text-gray-500">
                    NSDL or CDSL demat account statement — PDF only, max 10 MB.
                </p>
                <label className="inline-block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 px-6 py-4 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                    {upload.status === 'uploading' ? 'Uploading…' : 'Click to select PDF'}
                    <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileChange}
                        disabled={upload.status === 'uploading'}
                        className="hidden"
                    />
                </label>

                {upload.status === 'success' && (
                    <div className="mt-4 rounded bg-green-50 px-4 py-3 text-sm text-green-800">
                        <strong>
                            {upload.fromCache ? 'Returned from cache — ' : ''}
                            {upload.holdingsCount} holding{upload.holdingsCount !== 1 ? 's' : ''} imported.
                        </strong>
                    </div>
                )}

                {upload.status === 'error' && (
                    <div className="mt-4 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
                        <strong>{upload.message}</strong>
                        {Array.isArray(upload.details) && upload.details.length > 0 && (
                            <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                                {upload.details.slice(0, 5).map((d, i) => (
                                    <li key={i}>{String(d)}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </section>

            <section>
                <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-base font-semibold">
                        Holdings {loading ? '' : `(${holdings.length})`}
                    </h2>
                    {totalValue > 0 && (
                        <span className="text-sm text-gray-500">
                            Total:{' '}
                            <span className="font-semibold text-gray-900">
                                ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                        </span>
                    )}
                </div>

                {loading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                ) : holdings.length === 0 ? (
                    <p className="rounded-xl border bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
                        No equity holdings yet. Upload your demat statement PDF above.
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-4 py-2 text-left">Company</th>
                                    <th className="px-4 py-2 text-right">Quantity</th>
                                    <th className="px-4 py-2 text-right">Price</th>
                                    <th className="px-4 py-2 text-right">Value (₹)</th>
                                    <th className="px-4 py-2 text-right">As of</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {holdings.map((h) => (
                                    <tr key={h.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-2">
                                            <div className="font-medium leading-snug">{h.companyName}</div>
                                            <div className="text-xs text-gray-400">{h.isin}</div>
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums">{parseFloat(h.quantity).toLocaleString('en-IN')}</td>
                                        <td className="px-4 py-2 text-right tabular-nums">{parseFloat(h.price).toFixed(2)}</td>
                                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                                            {parseFloat(h.value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-2 text-right text-gray-500">{h.asOfDate}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <div className="mt-6 rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                <strong>Educational view only.</strong> These are holdings extracted from your demat statement. This page does not recommend buying, selling, or holding any stock.
            </div>

            <p className="mt-8 text-center text-xs text-gray-400">
                PF Copilot · Educational tool · Not investment advice
            </p>
        </main>
    )
}
