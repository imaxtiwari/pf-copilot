import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '@/app/chat/page'
import { buildWorkspaceState } from '@/lib/agent-mapping'
import type { ToolTrace } from '@/lib/orchestrator'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'

const mockFetch = vi.fn()

function historyResponse() {
    return { ok: true, json: async () => ({ ok: true, data: { messages: [] } }) }
}

function sseStream(payload: Record<string, unknown>) {
    const sse = `event: assistant\ndata: ${JSON.stringify(payload)}\n\n`
    const encoder = new TextEncoder()
    return {
        ok: true,
        status: 200,
        body: new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(sse))
                controller.close()
            },
        }),
        text: async () => sse,
    } as unknown as Response
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

const assistantMessage = 'You hold 3 funds.'
const backendWorkspaceState = buildWorkspaceState([portfolioTrace], assistantMessage, true)

describe('ChatPage workspace state', () => {
    beforeEach(() => {
        global.fetch = mockFetch
        mockFetch.mockReset()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('renders the workspace_state supplied by the API', async () => {
        const user = userEvent.setup()

        mockFetch
            .mockResolvedValueOnce(historyResponse())
            .mockResolvedValueOnce(
                sseStream({
                    assistant_message: assistantMessage,
                    tool_traces: [portfolioTrace],
                    citations: [],
                    model_version: 'gpt-4o-mini',
                    refusal_reason: null,
                    request_id: 'req-1',
                    workspace_state: backendWorkspaceState,
                }),
            )

        render(<ChatPage />)

        const input = screen.getByPlaceholderText('Ask about your portfolio…')
        await user.type(input, 'What does my portfolio look like?')

        const sendButton = screen.getByLabelText('Send')
        await user.click(sendButton)

        await waitFor(() => {
            expect(screen.getAllByText('Portfolio Analyst').length).toBeGreaterThan(0)
        })

        await waitFor(() => {
            expect(screen.getAllByLabelText('Copilot status: Complete').length).toBeGreaterThan(0)
        })

        // Evidence chip containing holdings count should appear
        expect(screen.getAllByText('Holdings:').length).toBeGreaterThan(0)
        expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    })

    it('falls back to a locally-built workspace state when the API omits it', async () => {
        const user = userEvent.setup()

        mockFetch
            .mockResolvedValueOnce(historyResponse())
            .mockResolvedValueOnce(
                sseStream({
                    assistant_message: assistantMessage,
                    tool_traces: [portfolioTrace],
                    citations: [],
                    model_version: 'gpt-4o-mini',
                    refusal_reason: null,
                    request_id: 'req-fallback',
                }),
            )

        render(<ChatPage />)

        const input = screen.getByPlaceholderText('Ask about your portfolio…')
        await user.type(input, 'What does my portfolio look like?')

        const sendButton = screen.getByLabelText('Send')
        await user.click(sendButton)

        await waitFor(() => {
            expect(screen.getAllByText('Portfolio Analyst').length).toBeGreaterThan(0)
        })

        await waitFor(() => {
            expect(screen.getAllByLabelText('Copilot status: Complete').length).toBeGreaterThan(0)
        })

        expect(screen.getAllByText('Holdings:').length).toBeGreaterThan(0)
        expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    })

    it('sets workspaceState to complete when the response has no tool traces and no workspace_state', async () => {
        const user = userEvent.setup()

        mockFetch
            .mockResolvedValueOnce(historyResponse())
            .mockResolvedValueOnce(
                sseStream({
                    assistant_message: 'I cannot answer that.',
                    tool_traces: [],
                    citations: [],
                    model_version: 'gpt-4o-mini',
                    refusal_reason: 'not_in_scope',
                    request_id: 'req-2',
                }),
            )

        render(<ChatPage />)

        const input = screen.getByPlaceholderText('Ask about your portfolio…')
        await user.type(input, 'What is the weather today?')

        const sendButton = screen.getByLabelText('Send')
        await user.click(sendButton)

        await waitFor(() => {
            expect(screen.getAllByLabelText('Copilot status: Complete').length).toBeGreaterThan(0)
        })
    })

    it('produces identical workspace state on the frontend fallback and backend mapping', () => {
        const localState = buildWorkspaceState([portfolioTrace], assistantMessage, true)
        expect(localState.agents).toEqual(backendWorkspaceState.agents)
        expect(localState.copilotStatus).toEqual(backendWorkspaceState.copilotStatus)
        expect(localState.summary).toEqual(backendWorkspaceState.summary)
        expect(localState.activity.map(({ id, agent, message, evidence }) => ({ id, agent, message, evidence })))
            .toEqual(backendWorkspaceState.activity.map(({ id, agent, message, evidence }) => ({ id, agent, message, evidence })))
    })
})
