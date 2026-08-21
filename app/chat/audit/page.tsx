'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Citation = {
    chunk_id: string
    factsheet_date: string
    section: string
    chunkText?: string
}

type AuditMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    ts: string
    citations: Citation[]
    model_version: string | null
    refusal_reason: string | null
    request_id: string | null
}

const PAGE_SIZE = 25

const refusalLabels: Record<string, string> = {
    no_factsheet_data: 'No factsheet data available for this query.',
    unknown_scheme_code: 'Unknown scheme code — could not resolve fund.',
    contract_violation: 'Model output violated the safety contract.',
    no_retrieval_result: 'No relevant factsheet chunks were retrieved.',
}

function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

export default function ChatAuditPage() {
    const [messages, setMessages] = useState<AuditMessage[]>([])
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [hasNext, setHasNext] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const [chunkCache, setChunkCache] = useState<Record<string, Citation>>({})

    const load = useCallback(async (p: number) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/chat/audit?page=${p}&pageSize=${PAGE_SIZE}`)
            const json = (await res.json()) as {
                ok: boolean
                data?: { messages: AuditMessage[]; pagination: { total: number; hasNext: boolean } }
                error?: { message: string }
            }
            if (json.ok && json.data) {
                setMessages(json.data.messages)
                setTotal(json.data.pagination.total)
                setHasNext(json.data.pagination.hasNext)
            } else {
                setError(json.error?.message ?? 'Failed to load audit log.')
            }
        } catch {
            setError('Network error while loading audit log.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load(1)
    }, [load])

    async function fetchChunkText(chunkId: string) {
        if (chunkCache[chunkId]?.chunkText) return
        try {
            const res = await fetch(`/api/chat/audit/chunk?id=${encodeURIComponent(chunkId)}`)
            const json = (await res.json()) as { ok: boolean; data?: { chunkText: string }; error?: { message: string } }
            if (json.ok && json.data) {
                setChunkCache((prev) => ({
                    ...prev,
                    [chunkId]: { ...(prev[chunkId] ?? { chunk_id: chunkId, factsheet_date: '', section: '' }), chunkText: json.data!.chunkText },
                }))
            }
        } catch {
            setChunkCache((prev) => ({
                ...prev,
                [chunkId]: { ...(prev[chunkId] ?? { chunk_id: chunkId, factsheet_date: '', section: '' }), chunkText: 'Unable to load chunk text.' },
            }))
        }
    }

    function toggleExpanded(id: string) {
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
    }

    function handleCitationClick(c: Citation) {
        void fetchChunkText(c.chunk_id)
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-6">
            <div className="mx-auto max-w-3xl">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Chat audit</h1>
                        <p className="text-sm text-gray-500">
                            Traceable citations, model versions, and refusal reasons for every assistant response.
                        </p>
                    </div>
                    <Link
                        href="/chat"
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Back to chat
                    </Link>
                </div>

                {error && (
                    <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        {error}
                    </div>
                )}

                {loading && messages.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500">Loading history…</div>
                ) : messages.length === 0 ? (
                    <div className="rounded-xl border bg-white p-8 text-center">
                        <p className="text-sm text-gray-500">No messages found.</p>
                        <Link href="/chat" className="mt-2 inline-block text-sm text-indigo-600 hover:underline">
                            Start a conversation
                        </Link>
                    </div>
                ) : (
                    <>
                        <div className="space-y-3">
                            {messages.map((msg) => {
                                const isUser = msg.role === 'user'
                                const expandedId = msg.id
                                const isExpanded = expanded[expandedId]
                                const hasMeta =
                                    msg.citations.length > 0 || msg.refusal_reason || msg.model_version || msg.request_id

                                return (
                                    <div
                                        key={msg.id}
                                        className={`rounded-xl border bg-white p-4 shadow-sm ${isUser ? 'border-indigo-100' : 'border-gray-200'}`}
                                    >
                                        <div className="mb-2 flex items-center justify-between">
                                            <span
                                                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${isUser ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                                                    }`}
                                            >
                                                {isUser ? 'You' : 'Assistant'}
                                            </span>
                                            <span className="text-xs text-gray-400">{formatDate(msg.ts)}</span>
                                        </div>

                                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{msg.content}</p>

                                        {!isUser && msg.refusal_reason && (
                                            <div className="mt-3 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                                                <span className="font-semibold">Refused:</span>{' '}
                                                {refusalLabels[msg.refusal_reason] ?? msg.refusal_reason}
                                            </div>
                                        )}

                                        {!isUser && hasMeta && (
                                            <div className="mt-3">
                                                <button
                                                    onClick={() => toggleExpanded(expandedId)}
                                                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                                                >
                                                    {isExpanded ? 'Hide trace' : 'Show trace'}
                                                </button>

                                                {isExpanded && (
                                                    <div className="mt-2 space-y-3 rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
                                                        {msg.model_version && (
                                                            <div>
                                                                <span className="font-semibold text-gray-600">Model:</span>{' '}
                                                                {msg.model_version}
                                                            </div>
                                                        )}
                                                        {msg.request_id && (
                                                            <div>
                                                                <span className="font-semibold text-gray-600">Request ID:</span>{' '}
                                                                <span className="font-mono">{msg.request_id}</span>
                                                            </div>
                                                        )}

                                                        {msg.citations.length > 0 && (
                                                            <div>
                                                                <div className="mb-1 font-semibold text-gray-600">Citations:</div>
                                                                <ul className="space-y-2">
                                                                    {msg.citations.map((c, idx) => (
                                                                        <li key={`${c.chunk_id}-${idx}`} className="break-words">
                                                                            <button
                                                                                onClick={() => handleCitationClick(c)}
                                                                                className="text-left font-mono text-indigo-700 hover:underline"
                                                                            >
                                                                                {c.chunk_id}
                                                                            </button>
                                                                            {' — '}
                                                                            <span className="text-gray-500">{c.section}</span>
                                                                            {' · '}
                                                                            <span className="text-gray-400">{c.factsheet_date}</span>
                                                                            {chunkCache[c.chunk_id]?.chunkText && (
                                                                                <div className="mt-1 rounded border border-gray-200 bg-white p-2 text-gray-700">
                                                                                    {chunkCache[c.chunk_id].chunkText}
                                                                                </div>
                                                                            )}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <div className="mt-6 flex items-center justify-between">
                            <button
                                onClick={() => {
                                    setPage((p) => p - 1)
                                    void load(page - 1)
                                }}
                                disabled={page <= 1 || loading}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                            >
                                Previous
                            </button>
                            <span className="text-sm text-gray-500">
                                Page {page} of {totalPages} · {total} messages
                            </span>
                            <button
                                onClick={() => {
                                    setPage((p) => p + 1)
                                    void load(page + 1)
                                }}
                                disabled={!hasNext || loading}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
