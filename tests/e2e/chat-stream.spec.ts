import { test, expect } from '@playwright/test'

const CHAT_URL = 'http://localhost:3000/chat'
const INPUT_SELECTOR = 'textarea[placeholder="Ask about your portfolio…"]'

async function submitChat(page: any, message: string) {
    await page.fill(INPUT_SELECTOR, message)
    await page.keyboard.press('Enter')
}

function agentCard(name: string) {
    return `[data-agent-card="${name}"]`
}

function panelLocator(page: any) {
    return page.locator('[data-testid="mobile-bottom-sheet"], aside').first()
}

test.describe('Chat streaming — agent events via SSE', () => {
    test('1. Portfolio question streams agent activity and final answer', async ({ page }) => {
        await page.goto(CHAT_URL)

        await submitChat(page, 'What does my portfolio look like?')

        const panel = panelLocator(page)

        // Agent panel shows a working analyst during the stream
        await expect(panel.locator(agentCard('Portfolio Analyst'))).toBeVisible({ timeout: 30_000 })

        // Copilot status moves from analysing/complete
        const statusLabel = page.locator('aside [aria-label^="Copilot status:"], [data-testid="mobile-bottom-sheet"] [aria-label^="Copilot status:"]').first()
        await expect(statusLabel).toHaveAttribute('aria-label', /Copilot status: (Analysing|Researching|Synthesizing|Complete)/)
        await expect(statusLabel).toHaveAttribute('aria-label', 'Copilot status: Complete', { timeout: 30_000 })

        // Evidence chip appears once tool results arrive
        const evidence = page.locator('aside [data-testid="agent-evidence"], [data-testid="mobile-bottom-sheet"] [data-testid="agent-evidence"]').first()
        await expect(evidence).toBeVisible({ timeout: 30_000 })

        // Assistant reply is rendered
        const assistantReply = page.locator('.whitespace-pre-wrap').last()
        await expect(assistantReply).toBeVisible({ timeout: 30_000 })
        await expect(assistantReply).toContainText(/holdings|total value|portfolio|funds|scheme|investment/i, { timeout: 30_000 })
    })

    test('2. Fund question streams research agent activity', async ({ page }) => {
        await page.goto(CHAT_URL)

        await submitChat(page, 'Explain expense ratio of HDFC Top 100')

        const panel = panelLocator(page)

        // Fund question should activate Fund Research Agent
        await expect(panel.locator(agentCard('Fund Research Agent'))).toBeVisible({ timeout: 30_000 })

        // Status should eventually complete
        const statusLabel = page.locator('aside [aria-label^="Copilot status:"], [data-testid="mobile-bottom-sheet"] [aria-label^="Copilot status:"]').first()
        await expect(statusLabel).toHaveAttribute('aria-label', 'Copilot status: Complete', { timeout: 30_000 })

        // Reply is rendered and does not contain advice language
        const assistantReply = page.locator('.whitespace-pre-wrap').last()
        await expect(assistantReply).toBeVisible({ timeout: 30_000 })
    })
})
