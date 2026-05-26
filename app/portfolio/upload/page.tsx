'use client'
import Link from 'next/link'
import { useState, useEffect, useRef, type ChangeEvent } from 'react'

type Holding = {
  id: string
  schemeName: string
  folioNumber: string
  units: string
  nav: string
  marketValue: string
  asOfDate: string
  source: string
}

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; holdingsCount: number; unmatched: string[]; fromCache?: boolean }
  | { status: 'error'; message: string; details?: unknown }

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(true)
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchHoldings()
  }, [])

  async function fetchHoldings() {
    setLoadingHoldings(true)
    try {
      const res = await fetch('/api/portfolio/holdings')
      const json = await res.json()
      if (json.ok) setHoldings(json.data.holdings)
    } catch {
      // silently ignore — holdings table may be empty
    } finally {
      setLoadingHoldings(false)
    }
  }

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
      const res = await fetch('/api/cas/ingest', { method: 'POST', body: form })
      const json = await res.json()
      if (json.ok) {
        setUpload({
          status: 'success',
          holdingsCount: json.data.holdings_count,
          unmatched: json.data.unmatched_schemes ?? [],
          fromCache: json.data.from_cache,
        })
        fetchHoldings()
      } else {
        setUpload({ status: 'error', message: json.error?.message ?? 'Upload failed.', details: json.error?.details })
      }
    } catch {
      setUpload({ status: 'error', message: 'Network error. Please try again.' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const totalValue = holdings.reduce((s, h) => s + parseFloat(h.marketValue || '0'), 0)

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Upload CAS</h1>
        <Link href="/portfolio" className="text-sm text-indigo-600 underline-offset-2 hover:underline">
          ← View returns
        </Link>
      </div>

      {/* Upload section */}
      <section className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Upload CAS PDF</h2>
        <p className="mb-4 text-sm text-gray-500">
          NSDL or CDSL Consolidated Account Statement — PDF only, max 10 MB.
        </p>
        <label className="inline-block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 px-6 py-4 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
          {upload.status === 'uploading' ? 'Uploading…' : 'Click to select PDF'}
          <input
            ref={fileRef}
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
            {upload.unmatched.length > 0 && (
              <p className="mt-1 text-xs text-green-700">
                {upload.unmatched.length} scheme{upload.unmatched.length !== 1 ? 's' : ''} not found in AMFI master:{' '}
                {upload.unmatched.join(', ')}
              </p>
            )}
            <div className="mt-3">
              <Link
                href="/portfolio"
                className="inline-block rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
              >
                View real returns →
              </Link>
            </div>
          </div>
        )}

        {upload.status === 'error' && (
          <div className="mt-4 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>{upload.message}</strong>
            {Array.isArray(upload.details) && upload.details.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                {(upload.details as string[]).slice(0, 5).map((d, i) => (
                  <li key={i}>{String(d)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Holdings table */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            Holdings {loadingHoldings ? '' : `(${holdings.length})`}
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

        {loadingHoldings ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : holdings.length === 0 ? (
          <p className="rounded-xl border bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
            No holdings yet. Upload your CAS PDF above.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Scheme</th>
                  <th className="px-4 py-2 text-right">Units</th>
                  <th className="px-4 py-2 text-right">NAV</th>
                  <th className="px-4 py-2 text-right">Value (₹)</th>
                  <th className="px-4 py-2 text-right">As of</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {holdings.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="font-medium leading-snug">{h.schemeName}</div>
                      <div className="text-xs text-gray-400">{h.folioNumber}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{parseFloat(h.units).toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{parseFloat(h.nav).toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">
                      {parseFloat(h.marketValue).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{h.asOfDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-gray-400">
        Educational tool only — not investment advice.
      </p>
    </main>
  )
}
