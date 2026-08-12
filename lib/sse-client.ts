/**
 * Client-side helpers for consuming Server-Sent Events (SSE).
 *
 * `subscribeToChatStream` is used by the chat page to POST to `/api/chat/stream`
 * and receive agent events + the final assistant payload without polling.
 *
 * `subscribeWithEventSource` is a generic EventSource wrapper for callers that
 * can use a GET-style SSE endpoint.
 */

import type { AgentEvent, CopilotStatus, WorkspaceState } from '@/lib/contracts/agent-events'
import type { ToolTrace } from '@/lib/orchestrator'

// ── types ─────────────────────────────────────────────────────────────────────

export type Citation = {
    chunk_id: string
    section: string
    factsheet_date: string
}

export type ChatStreamData = {
    assistant_message: string
    tool_traces: ToolTrace[]
    citations: Citation[]
    model_version: string
    refusal_reason: string | null
    request_id: string
    workspace_state?: WorkspaceState
    timestamp?: string
}

export type ChatStreamCallbacks = {
    onEvent?: (event: AgentEvent) => void
    onStatusChange?: (status: CopilotStatus) => void
    onComplete?: (data: ChatStreamData) => void
    onError?: (error: { code: string; message: string; request_id?: string }) => void
}

// ── fetch-based SSE reader ────────────────────────────────────────────────────

export function subscribeToChatStream(
    url: string,
    body: { message: string; language?: string },
    callbacks: ChatStreamCallbacks,
): () => void {
    const abortController = new AbortController()
    let closed = false

    const close = () => {
        if (closed) return
        closed = true
        abortController.abort()
    }

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
    })
        .then(async (res) => {
            if (!res.ok || !res.body) {
                const text = await res.text().catch(() => 'Stream failed')
                let parsed: { error?: { message?: string; code?: string; request_id?: string } } | null = null
                try {
                    parsed = JSON.parse(text)
                } catch {
                    // ignore parse failure
                }
                callbacks.onError?.({
                    code: parsed?.error?.code ?? 'STREAM_ERROR',
                    message: parsed?.error?.message ?? text,
                    request_id: parsed?.error?.request_id,
                })
                return
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let currentEvent: { name?: string; dataLines: string[] } = { dataLines: [] }

            const flushEvent = () => {
                const { name, dataLines } = currentEvent
                const data = dataLines.join('\n')
                currentEvent = { dataLines: [] }
                if (!name || data === '') return
                try {
                    const payload = JSON.parse(data)
                    if (name === 'agent') {
                        callbacks.onEvent?.(payload as AgentEvent)
                    } else if (name === 'copilot_status') {
                        callbacks.onStatusChange?.((payload as { status: CopilotStatus }).status)
                    } else if (name === 'assistant') {
                        callbacks.onComplete?.(payload as ChatStreamData)
                    } else if (name === 'error') {
                        callbacks.onError?.(payload as { code: string; message: string; request_id?: string })
                    }
                } catch {
                    // malformed SSE payload — skip silently
                }
            }

            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    flushEvent()
                    break
                }

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''

                for (const raw of lines) {
                    const line = raw.replace(/\r$/, '')
                    if (line === '') {
                        flushEvent()
                    } else if (line.startsWith('event:')) {
                        currentEvent.name = line.slice(6).trim()
                    } else if (line.startsWith('data:')) {
                        currentEvent.dataLines.push(line.slice(5).trim())
                    }
                    // ignore comment lines and unknown fields
                }
            }
        })
        .catch((e: unknown) => {
            if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return
            callbacks.onError?.({
                code: 'NETWORK_ERROR',
                message: e instanceof Error ? e.message : String(e),
            })
        })

    return close
}

// ── generic EventSource helper ────────────────────────────────────────────────

export type EventSourceCallbacks = {
    onEvent?: (event: AgentEvent) => void
    onStatusChange?: (status: CopilotStatus) => void
    onComplete?: (data: ChatStreamData) => void
    onError?: (error: { code: string; message: string; request_id?: string }) => void
    onOpen?: () => void
}

export function subscribeWithEventSource(
    url: string,
    callbacks: EventSourceCallbacks,
): () => void {
    const es = new EventSource(url)

    es.addEventListener('open', () => {
        callbacks.onOpen?.()
    })

    es.addEventListener('agent', (msg) => {
        try {
            const payload = JSON.parse((msg as MessageEvent).data)
            callbacks.onEvent?.(payload)
        } catch {
            // ignore malformed event
        }
    })

    es.addEventListener('copilot_status', (msg) => {
        try {
            const payload = JSON.parse((msg as MessageEvent).data)
            callbacks.onStatusChange?.(payload.status)
        } catch {
            // ignore malformed event
        }
    })

    es.addEventListener('assistant', (msg) => {
        try {
            const payload = JSON.parse((msg as MessageEvent).data)
            callbacks.onComplete?.(payload)
        } catch {
            // ignore malformed event
        }
    })

    es.addEventListener('error', (msg) => {
        if (msg instanceof MessageEvent && msg.data) {
            try {
                const payload = JSON.parse(msg.data)
                callbacks.onError?.(payload)
                return
            } catch {
                // fall through to generic error
            }
        }
        callbacks.onError?.({ code: 'SSE_ERROR', message: 'EventSource error' })
    })

    return () => es.close()
}
