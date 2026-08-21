import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PortfolioPage from '@/app/portfolio/page'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'

const mockState = vi.hoisted(() => ({
    db: {
        select: vi.fn(),
        execute: vi.fn(),
        query: {
            userProfile: { findFirst: vi.fn() },
            portfolioInsights: { findFirst: vi.fn() },
        },
        insert: vi.fn(),
    },
    getLatestInsight: vi.fn(),
    getAllocationForUser: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockState.db }))
vi.mock('@/lib/portfolio/insights', () => ({ getLatestInsight: mockState.getLatestInsight }))
vi.mock('@/lib/portfolio/get-allocation', () => ({ getAllocationForUser: mockState.getAllocationForUser }))

vi.mock('next/headers', () => ({
    cookies: vi.fn(async () => ({
        get: vi.fn((name: string) => (name === 'pf_user_id' ? { value: 'user-123' } : undefined)),
    })),
}))

function mockHoldingRows(rows: Array<{
    schemeCode: string | null
    schemeName: string
    units: string
    nav: string
    marketValue: string
}>) {
    const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => Promise.resolve(rows)),
    }
    mockState.db.select.mockReturnValueOnce(chain)
}

function mockSnapshots(rows: Array<{ asOfDate: string; totalValue: string; realReturnAnnualized: string | null }>) {
    const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => Promise.resolve(rows)),
    }
    mockState.db.select.mockReturnValueOnce(chain)
}

function mockFactsheetReturns(rows: Array<{ scheme_code: string; chunk_text: string; factsheet_date: string }>) {
    mockState.db.execute.mockResolvedValue({ rows })
}

const expectedAgents = [
    'Portfolio Analyst',
    'Inflation Analyst',
    'Performance Analyst',
    'Risk Analyst',
    'Copilot',
]

describe('PortfolioPage compact AI Workspace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockState.db.query.userProfile.findFirst.mockResolvedValue({
            age: 35,
            inflationRate: '0.069',
            inflationConfidence: 'medium',
        })
        mockState.getLatestInsight.mockResolvedValue({
            id: 'insight-1',
            userId: 'user-123',
            casUploadId: null,
            template: 'personal_inflation_vs_cpi',
            title: 'Your personal inflation rate',
            body: 'Your personal inflation rate is 6.90%, 0.90% above the latest RBI/CPI estimate.',
            data: {},
            generatedAt: new Date().toISOString(),
        })
        mockState.getAllocationForUser.mockResolvedValue({
            ok: true,
            data: {
                buckets: [
                    { bucket: 'Equity - Large Cap', value: 500000, weight: 0.5, holdingCount: 1 },
                    { bucket: 'Debt', value: 500000, weight: 0.5, holdingCount: 1 },
                ],
                totalValue: 1000000,
                topHoldings: [],
                unknownWeight: 0,
            },
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('renders the compact AgentActivityPanel with all expected agent names', async () => {
        mockHoldingRows([
            {
                schemeCode: 'SC001',
                schemeName: 'Test Large Cap Fund',
                units: '100',
                nav: '5000',
                marketValue: '500000',
            },
            {
                schemeCode: 'SC002',
                schemeName: 'Test Debt Fund',
                units: '100',
                nav: '5000',
                marketValue: '500000',
            },
        ])
        mockFactsheetReturns([
            { scheme_code: 'SC001', chunk_text: '1 year return 12%', factsheet_date: '2026-07-01' },
            { scheme_code: 'SC002', chunk_text: '1 year return 7%', factsheet_date: '2026-07-01' },
        ])
        mockSnapshots([])

        const Page = await PortfolioPage()
        render(Page)

        expect(screen.getByTestId('portfolio-workspace-panel')).toBeInTheDocument()

        for (const agent of expectedAgents) {
            expect(screen.getByText(agent)).toBeInTheDocument()
        }

        expect(screen.queryByTestId('activity-section')).not.toBeInTheDocument()
    })

    it('renders the compact panel even when there is no insight', async () => {
        mockState.getLatestInsight.mockResolvedValue(null)
        mockHoldingRows([
            {
                schemeCode: 'SC001',
                schemeName: 'Test Large Cap Fund',
                units: '100',
                nav: '5000',
                marketValue: '500000',
            },
        ])
        mockFactsheetReturns([])
        mockSnapshots([])

        const Page = await PortfolioPage()
        render(Page)

        expect(screen.getByTestId('portfolio-workspace-panel')).toBeInTheDocument()

        for (const agent of expectedAgents) {
            expect(screen.getByText(agent)).toBeInTheDocument()
        }
    })
})
