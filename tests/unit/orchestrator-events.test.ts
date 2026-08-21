import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { runOrchestratorWithEvents } from '@/lib/orchestrator'
import type { OrchestratorAgentEvent } from '@/lib/contracts/agent-events'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
process.env.AZURE_OPENAI_API_KEY = 'test-key'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'test-deployment'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O = 'test-deployment'

const portfolioResult = {
    holdings: [{ scheme_name: 'Nifty 50 Index Fund', scheme_code: '120503', market_value: 250000, units: 100, nav: 2500, as_of_date: '2026-07-26' }],
    total_value: 250000,
    truncated: null,
    asset_mix: { Equity: 100 },
}

const inflationResult = {
    inflation_rate: 6.8,
    confidence: 'high',
    breakdown: [{ sleeve: 'housing', weight: 0.35, rate: 8.2, contribution: 2.9 }],
    computed_at: '2026-01-01T00:00:00Z',
    note: null,
}

vi.mock('@/lib/db', () => ({
    db: {
        insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
    },
}))

const mockCreate = vi.fn()

vi.mock('@/lib/azure-openai', () => ({
    getGpt4oMini: () => ({
        chat: {
            completions: {
                create: (...args: unknown[]) => mockCreate(...args),
            },
        },
    }),
}))

vi.mock('@/lib/tools/get-portfolio', () => ({
    getPortfolio: vi.fn().mockResolvedValue({
        holdings: [{ scheme_name: 'Nifty 50 Index Fund', scheme_code: '120503', market_value: 250000, units: 100, nav: 2500, as_of_date: '2026-07-26' }],
        total_value: 250000,
        truncated: null,
        asset_mix: { Equity: 100 },
    }),
}))

vi.mock('@/lib/tools/compute-inflation', () => ({
    computePersonalInflationTool: vi.fn().mockResolvedValue({
        inflation_rate: 6.8,
        confidence: 'high',
        breakdown: [{ sleeve: 'housing', weight: 0.35, rate: 8.2, contribution: 2.9 }],
        computed_at: '2026-01-01T00:00:00Z',
        note: null,
    }),
}))

vi.mock('@/lib/tools/compute-real-returns', () => ({
    computeRealReturns: vi.fn(),
}))

vi.mock('@/lib/tools/lookup-chat-history', () => ({
    lookupChatHistory: vi.fn(),
}))

vi.mock('@/lib/tools/explain-fund', () => ({
    explainFundTool: vi.fn(),
}))

vi.mock('@/lib/tools/explain-stock', () => ({
    explainStockTool: vi.fn(),
}))

vi.mock('@/lib/tools/compare-funds', () => ({
    compareFundsTool: vi.fn(),
}))

describe('runOrchestratorWithEvents', () => {
    let events: OrchestratorAgentEvent[] = []

    beforeEach(() => {
        events = []
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    function captureEvent(event: OrchestratorAgentEvent) {
        events.push(event)
    }

    it('emits AgentStarted, ToolCalled, ToolCompleted, FindingCreated, AgentCompleted for each tool', async () => {
        mockCreate
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                {
                                    id: 'call-1',
                                    type: 'function',
                                    function: { name: 'get_portfolio', arguments: '{}' },
                                },
                            ],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                {
                                    id: 'call-2',
                                    type: 'function',
                                    function: { name: 'compute_personal_inflation', arguments: '{}' },
                                },
                            ],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { role: 'assistant', content: 'Your portfolio and inflation summary.' } }],
            })

        const result = await runOrchestratorWithEvents('user-1', 'What is my portfolio and inflation?', 'en', captureEvent)

        expect(result.assistant_message).toBe('Your portfolio and inflation summary.')
        expect(events.length).toBeGreaterThan(0)

        const portfolioEvents = events.filter((e) => e.agent === 'Portfolio Analyst')
        expect(portfolioEvents.some((e) => e.type === 'AgentStarted')).toBe(true)
        expect(portfolioEvents.some((e) => e.type === 'ToolCalled' && e.tool === 'get_portfolio')).toBe(true)
        expect(portfolioEvents.some((e) => e.type === 'ToolCompleted' && e.tool === 'get_portfolio' && e.success === true)).toBe(true)
        expect(portfolioEvents.some((e) => e.type === 'FindingCreated')).toBe(true)
        expect(portfolioEvents.some((e) => e.type === 'AgentCompleted')).toBe(true)

        const inflationEvents = events.filter((e) => e.agent === 'Inflation Analyst')
        expect(inflationEvents.some((e) => e.type === 'AgentStarted')).toBe(true)
        expect(inflationEvents.some((e) => e.type === 'ToolCalled' && e.tool === 'compute_personal_inflation')).toBe(true)
        expect(inflationEvents.some((e) => e.type === 'ToolCompleted' && e.tool === 'compute_personal_inflation' && e.success === true)).toBe(true)
        expect(inflationEvents.some((e) => e.type === 'AgentCompleted')).toBe(true)
    })

    it('emits ToolCompleted with success=false when a tool returns an error', async () => {
        const { getPortfolio } = await import('@/lib/tools/get-portfolio')

        vi.mocked(getPortfolio).mockResolvedValueOnce({ error: 'Database unavailable' } as unknown as Awaited<ReturnType<typeof getPortfolio>>)

        mockCreate.mockReset()
        mockCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call-err',
                                type: 'function',
                                function: { name: 'get_portfolio', arguments: '{}' },
                            },
                        ],
                    },
                },
            ],
        })
        // fallback final message after the single tool call
        mockCreate.mockResolvedValueOnce({
            choices: [{ message: { role: 'assistant', content: 'Sorry, I could not load your portfolio.' } }],
        })

        await runOrchestratorWithEvents('user-err', 'portfolio', 'en', captureEvent)

        const completed = events.find((e) => e.type === 'ToolCompleted' && e.tool === 'get_portfolio')
        expect(completed).toBeDefined()
        expect(completed!.success).toBe(false)
    })

    it('keeps the synchronous API unchanged when no onEvent is provided', async () => {
        const { runOrchestrator } = await import('@/lib/orchestrator')

        mockCreate.mockReset()
        mockCreate.mockResolvedValueOnce({
            choices: [{ message: { role: 'assistant', content: 'Synchronous answer.' } }],
        })

        const result = await runOrchestrator('user-sync', 'hello')

        expect(result.assistant_message).toBe('Synchronous answer.')
        expect(result.tool_traces).toEqual([])
        expect(result.request_id).toBeDefined()
    })
})
