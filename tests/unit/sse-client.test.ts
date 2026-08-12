import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { subscribeToChatStream, subscribeWithEventSource } from '@/lib/sse-client'

class MockController {
    readonly signal: AbortSignal
    private aborted = false
    private listeners = new Map<string, Set<() => void>>()

    constructor() {
        const handler: ProxyHandler<AbortSignal> = {
            get: (target, prop) => {
                if (prop === 'aborted') return this.aborted
                if (prop === 'addEventListener') {
                    return (event: string, cb: () => void) => this.addListener(event, cb)
                }
                if (prop === 'removeEventListener') {
                    return (event: string, cb: () => void) => this.removeListener(event, cb)
                }
                return (target as never)[prop as never]
            },
        }
        this.signal = new Proxy({} as AbortSignal, handler)
    }

    abort() {
        this.aborted = true
        this.listeners.get('abort')?.forEach((cb) => cb())
    }

    private addListener(event: string, cb: () => void) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set())
        this.listeners.get(event)!.add(cb)
    }

    private removeListener(event: string, cb: () => void) {
        this.listeners.get(event)?.delete(cb)
    }
}

function createFetchMock(streamData: string, ok = true, status = 200) {
    return vi.fn(async () => {
        let position = 0
        const encoder = new TextEncoder()
        const controller = new MockController()
        const body = new ReadableStream({
            start(c) {
                const timer = setInterval(() => {
                    if (controller.signal.aborted) {
                        clearInterval(timer)
                        return
                    }
                    if (position >= streamData.length) {
                        c.close()
                        clearInterval(timer)
                        return
                    }
                    const chunk = streamData.slice(position, position + 64)
                    position += chunk.length
                    c.enqueue(encoder.encode(chunk))
                }, 5)
            },
        })
        return {
            ok,
            status,
            body,
            text: async () => streamData,
        } as Response
    })
}

describe('subscribeToChatStream', () => {
    beforeEach(() => {
        global.fetch = createFetchMock('', true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('invokes onEvent and onStatusChange for streamed agent events', async () => {
        const sse = [
            'event: agent',
            'data: {"id":"e1","type":"agent_started","agent":"Fund Research Agent","timestamp":"2026-01-01T00:00:00.000Z","task":"started"}',
            '',
            'event: copilot_status',
            'data: {"id":"s1","type":"copilot_status","timestamp":"2026-01-01T00:00:00.000Z","status":"researching"}',
            '',
        ].join('\n')

        global.fetch = createFetchMock(sse)
        const onEvent = vi.fn()
        const onStatusChange = vi.fn()
        const onComplete = vi.fn()

        subscribeToChatStream('/api/chat/stream', { message: 'hello' }, { onEvent, onStatusChange, onComplete })

        await vi.waitFor(() => {
            expect(onEvent).toHaveBeenCalledTimes(1)
            expect(onStatusChange).toHaveBeenCalledTimes(1)
            expect(onComplete).not.toHaveBeenCalled()
        }, { interval: 10, timeout: 1000 })

        const eventArg = onEvent.mock.calls[0][0]
        expect(eventArg.type).toBe('agent_started')
        expect(eventArg.agent).toBe('Fund Research Agent')

        expect(onStatusChange.mock.calls[0][0]).toBe('researching')
    })

    it('invokes onComplete with assistant payload on final event', async () => {
        const sse = [
            'event: assistant',
            'data: {"assistant_message":"hi","tool_traces":[],"citations":[],"model_version":"gpt-4o-mini","refusal_reason":null,"request_id":"r1","timestamp":"2026-01-01T00:00:00.000Z"}',
            '',
        ].join('\n')

        global.fetch = createFetchMock(sse)
        const onComplete = vi.fn()
        const onError = vi.fn()

        subscribeToChatStream('/api/chat/stream', { message: 'hello' }, { onComplete, onError })

        await vi.waitFor(() => {
            expect(onComplete).toHaveBeenCalledTimes(1)
            expect(onError).not.toHaveBeenCalled()
        }, { interval: 10, timeout: 1000 })

        expect(onComplete.mock.calls[0][0]).toMatchObject({
            assistant_message: 'hi',
            request_id: 'r1',
        })
    })

    it('invokes onError when response is not ok', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 500,
            body: null,
            text: async () => JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }),
        }) as Response)

        const onError = vi.fn()
        subscribeToChatStream('/api/chat/stream', { message: 'hello' }, { onError })

        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1), { interval: 10, timeout: 1000 })

        expect(onError.mock.calls[0][0]).toMatchObject({ code: 'INTERNAL', message: 'boom' })
    })

    it('skips malformed SSE payloads silently', async () => {
        const sse = [
            'event: agent',
            'data: not-json',
            '',
            'event: assistant',
            'data: {"assistant_message":"ok","tool_traces":[],"citations":[],"model_version":"gpt-4o-mini","refusal_reason":null,"request_id":"r2"}',
            '',
        ].join('\n')

        global.fetch = createFetchMock(sse)
        const onEvent = vi.fn()
        const onComplete = vi.fn()

        subscribeToChatStream('/api/chat/stream', { message: 'hello' }, { onEvent, onComplete })

        await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { interval: 10, timeout: 1000 })
        expect(onEvent).not.toHaveBeenCalled()
    })
})

describe('subscribeWithEventSource', () => {
    class FakeEventSource {
        url: string
        readyState = 0
        private listeners: Record<string, Array<(msg: MessageEvent) => void>> = {}
        private onceOpen: Array<() => void> = []

        constructor(url: string) {
            this.url = url
        }

        addEventListener(event: string, cb: (msg: MessageEvent) => void) {
            if (!this.listeners[event]) this.listeners[event] = []
            this.listeners[event].push(cb)
        }

        close() {
            this.readyState = 2
        }

        emit(event: string, data: unknown) {
            const list = this.listeners[event] ?? []
            const msg = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent
            list.forEach((cb) => cb(msg))
        }
    }

    it('routes typed events to the correct callbacks', async () => {
        let es: FakeEventSource | null = null
        const Original = global.EventSource
        // @ts-expect-error replacing EventSource with fake in test
        global.EventSource = class extends FakeEventSource {
            constructor(url: string) {
                super(url)
                es = this
            }
        }

        const onEvent = vi.fn()
        const onStatusChange = vi.fn()
        const onComplete = vi.fn()

        subscribeWithEventSource('/api/chat/stream', {
            onEvent,
            onStatusChange,
            onComplete,
        })

        expect(es).toBeTruthy()

        es!.emit('agent', { id: 'e1', type: 'agent_started', agent: 'Risk Analyst', timestamp: new Date().toISOString(), task: 'started' })
        es!.emit('copilot_status', { id: 's1', type: 'copilot_status', timestamp: new Date().toISOString(), status: 'researching' })
        es!.emit('assistant', { assistant_message: 'done', tool_traces: [], citations: [], model_version: 'gpt-4o-mini', refusal_reason: null, request_id: 'r3' })

        await vi.waitFor(() => {
            expect(onEvent).toHaveBeenCalledTimes(1)
            expect(onStatusChange).toHaveBeenCalledTimes(1)
            expect(onComplete).toHaveBeenCalledTimes(1)
        }, { interval: 10, timeout: 1000 })

        expect(onEvent.mock.calls[0][0].type).toBe('agent_started')
        expect(onStatusChange.mock.calls[0][0]).toBe('researching')
        expect(onComplete.mock.calls[0][0].request_id).toBe('r3')

        global.EventSource = Original
    })
})
