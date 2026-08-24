'use client'

import { useEffect, useState } from 'react'

type SafetyFlag = {
  id: string
  user_id: string
  message_id: string
  content: string
  label: 'borderline' | 'advice'
  score: number
  reasoning: string | null
  reviewed: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

type ApiResponse =
  | { ok: true; data: { flags: SafetyFlag[]; pagination: { page: number; pageSize: number; total: number; hasNext: boolean } } }
  | { ok: false; error: { code: string; message: string } }

/**
 * Safety review queue admin page.
 *
 * TODO: Replace with server-side auth check and admin role gating.
 * Currently any authenticated user sees only their own flags.
 */
export default function SafetyAuditPage() {
  const [flags, setFlags] = useState<SafetyFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/chat/audit/safety?pageSize=100')
      .then((res) => res.json())
      .then((data: ApiResponse) => {
        if (!data.ok) {
          setError(data.error.message)
        } else {
          setFlags(data.data.flags)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Safety Review Queue</h1>
      <p className="text-sm text-gray-600 mb-6">
        Flagged assistant messages that are borderline or advice. Admin auth is a TODO.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {!loading && !error && flags.length === 0 && <p>No flags found.</p>}

      <div className="space-y-4">
        {flags.map((flag) => (
          <div key={flag.id} className="border rounded-lg p-4 shadow-sm bg-white">
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`px-2 py-1 text-xs font-medium rounded ${
                  flag.label === 'advice'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {flag.label}
              </span>
              <span className="text-sm text-gray-500">Score: {flag.score.toFixed(2)}</span>
              <span className="text-sm text-gray-400">
                {new Date(flag.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-gray-900 whitespace-pre-wrap mb-2">{flag.content}</p>
            {flag.reasoning && (
              <p className="text-sm text-gray-600 italic">Reasoning: {flag.reasoning}</p>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}
