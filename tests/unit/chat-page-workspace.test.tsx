import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from '@/app/chat/page'

const mockFetch = vi.fn()

function historyResponse() {
    return { ok: true, json: async () => ({ ok: true, data: { messages: [] } }) }
}

describe('ChatPage workspace state', () => {
    beforeEach(() => {
        global.fetch = mockFetch
        mockFetch.mockReset()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('produces a non-null workspaceState from a tool-trace API response', async () => {
        const user = userEvent.setup()

        mockFetch
            .mockResolvedValueOnce(historyResponse())
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    ok: true,
                    data: {
                        assistant_message: 'You hold 3 funds.',
                        tool_traces: [
                            {
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
                            },
                        ],
                        citations: [],
                        model_version: 'gpt-4o-mini',
                        refusal_reason: null,
                        request_id: 'req-1',
                    },
                }),
            })

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

    it('sets workspaceState to complete when the response has no tool traces', async () => {
        const user = userEvent.setup()

        mockFetch
            .mockResolvedValueOnce(historyResponse())
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    ok: true,
                    data: {
                        assistant_message: 'I cannot answer that.',
                        tool_traces: [],
                        citations: [],
                        model_version: 'gpt-4o-mini',
                        refusal_reason: 'not_in_scope',
                        request_id: 'req-2',
                    },
                }),
            })

        render(<ChatPage />)

        const input = screen.getByPlaceholderText('Ask about your portfolio…')
        await user.type(input, 'What is the weather today?')

        const sendButton = screen.getByLabelText('Send')
        await user.click(sendButton)

        await waitFor(() => {
            expect(screen.getAllByLabelText('Copilot status: Complete').length).toBeGreaterThan(0)
        })
    })
})
