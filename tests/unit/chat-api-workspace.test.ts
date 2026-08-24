import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/chat/route'
import { runOrchestrator, type ToolTrace } from '@/lib/orchestrator'
import * as agentMapping from '@/lib/agent-mapping'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'

vi.mock('@/lib/orchestrator', () => ({
    runOrchestrator: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
    db: {},
}))

vi.mock('@/lib/auth/dev-user', () => ({
    getCurrentUser: vi.fn().mockResolvedValue({ userId: 'test-user', isNew: false }),
}))

const mockedRunOrchestrator = vi.mocked(runOrchestrator)

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

const portfolioTrace: ToolTrace = {
    tool: 'get_portfolio',
    args: {},
    result: {
        holdings: [
            { scheme_name: 'HDFC Top 100 Fund', market_value: 500000 },
            { scheme_name: 'Parag Parikh Flexi Cap Fund', market_value: 300000 },
            { scheme_name: 'SBI Bluechip Fund', market_value: 200000 },
        ],
        total_value: 1000000,
    },
}

describe('POST /api/chat workspace_state', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        mockedRunOrchestrator.mockReset()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('returns workspace_state alongside existing fields', async () => {
        const assistantMessage = 'You hold 3 funds.'
        mockedRunOrchestrator.mockResolvedValue({
            assistant_message: assistantMessage,
            tool_traces: [portfolioTrace],
            citations: [],
            model_version: 'gpt-4o-mini',
            refusal_reason: null,
            request_id: 'req-1',
        })

        const res = await POST(makeRequest({ message: 'What does my portfolio look like?' }))
        const json = await res.json()

        expect(res.status).toBe(200)
        expect(json.ok).toBe(true)
        expect(json.data.assistant_message).toBe(assistantMessage)
        expect(json.data.tool_traces).toEqual([portfolioTrace])
        expect(json.data.workspace_state).toBeDefined()
        expect(json.data.workspace_state.agents).toHaveLength(6)
        expect(json.data.workspace_state.activity.length).toBeGreaterThan(0)
        expect(json.data.workspace_state.copilotStatus).toBe('complete')
        expect(json.data.workspace_state.summary).toContain('1 complete')
    })

    it('keeps all pre-existing response fields unchanged', async () => {
        mockedRunOrchestrator.mockResolvedValue({
            assistant_message: 'Answer.',
            tool_traces: [],
            citations: [],
            model_version: 'gpt-4o-mini',
            refusal_reason: 'unknown_scheme_code',
            request_id: 'req-bc',
        })

        const res = await POST(makeRequest({ message: 'hello' }))
        const json = await res.json()

        expect(json.data).toMatchObject({
            assistant_message: 'Answer.',
            tool_traces: [],
            citations: [],
            model_version: 'gpt-4o-mini',
            refusal_reason: 'unknown_scheme_code',
            request_id: 'req-bc',
        })
        expect(json.data.workspace_state).toBeDefined()
    })

    it('matches the locally-built workspace state for fixture traces', async () => {
        const assistantMessage = 'Backend and frontend should agree.'
        const fixtureTraces: ToolTrace[] = [portfolioTrace]

        mockedRunOrchestrator.mockResolvedValue({
            assistant_message: assistantMessage,
            tool_traces: fixtureTraces,
            citations: [],
            model_version: 'gpt-4o-mini',
            refusal_reason: null,
            request_id: 'req-match',
        })

        const res = await POST(makeRequest({ message: 'Match check' }))
        const json = await res.json()

        const localState = agentMapping.buildWorkspaceState(fixtureTraces, assistantMessage, true)
        expect(json.data.workspace_state.agents).toEqual(localState.agents)
        expect(json.data.workspace_state.copilotStatus).toEqual(localState.copilotStatus)
        expect(json.data.workspace_state.summary).toEqual(localState.summary)
        expect(json.data.workspace_state.activity.map(({ id, agent, message, evidence }: { id: string; agent: string; message: string; evidence?: unknown }) => ({ id, agent, message, evidence })))
            .toEqual(localState.activity.map(({ id, agent, message, evidence }) => ({ id, agent, message, evidence })))
    })
})
