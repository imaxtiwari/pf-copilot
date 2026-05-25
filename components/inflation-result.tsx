'use client'
import { useRouter } from 'next/navigation'
import type { InflationResult } from '../lib/inflation/compute'
import DisclaimerBanner from './disclaimer-banner'

const SLEEVE_LABELS: Record<string, string> = {
  general: 'General',
  medical: 'Medical',
  education: 'Education',
  lifestyle: 'Lifestyle',
}

export default function InflationResultView({ result }: { result: InflationResult }) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Your personal inflation rate
        </p>
        <p className="mt-2 text-5xl font-bold text-indigo-600">
          {(result.rate * 100).toFixed(2)}%
        </p>
        <p className="mt-1 text-xs capitalize text-gray-400">
          Confidence: {result.confidence}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Sleeve</th>
              <th className="px-4 py-2 text-right">Weight</th>
              <th className="px-4 py-2 text-right">Sleeve rate</th>
              <th className="px-4 py-2 text-right">Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.breakdown.map((b) => (
              <tr key={b.sleeve}>
                <td className="px-4 py-2 font-medium">{SLEEVE_LABELS[b.sleeve] ?? b.sleeve}</td>
                <td className="px-4 py-2 text-right text-gray-600">{(b.weight * 100).toFixed(1)}%</td>
                <td className="px-4 py-2 text-right text-gray-600">{(b.rate * 100).toFixed(1)}%</td>
                <td className="px-4 py-2 text-right font-semibold">{(b.contribution * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DisclaimerBanner />

      <button
        onClick={() => router.push('/')}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
      >
        Continue →
      </button>
    </div>
  )
}
