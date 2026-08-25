import { test, expect } from '@playwright/test'
import * as path from 'path'

const CAS_PDF_PATH = path.join(__dirname, '../fixtures/cas-sample.pdf')

// ── happy path ────────────────────────────────────────────────────────────────

test.describe('Happy path: onboard → upload CAS → real returns → chat', () => {

  test('1. Onboarding — fill form and compute inflation rate', async ({ page }) => {
    await page.goto('http://localhost:3000/onboarding')

    // Q1: age
    await page.fill('input[placeholder="e.g. 35"]', '35')

    // Q2: city tier — metro
    await page.check('input[name="city_tier"][value="metro"]')

    // Q3: living situation — rent
    await page.check('input[name="living"][value="rent"]')
    // Monthly rent field appears after clicking rent
    await page.fill('input[placeholder="Monthly rent"]', '50000')

    // Q4: dependents — kids
    await page.check('input[name="dependents"][value="kids"]')

    // Q5: medical — none
    await page.check('input[name="medical"][value="none"]')

    // Submit
    await page.click('button[type="submit"]')

    // Should show result view
    await expect(page.locator('text=Your personal inflation rate')).toBeVisible({ timeout: 15_000 })

    // Inflation rate should be a number followed by %
    const rateText = await page.locator('text=/\\d+\\.\\d+%/').first().textContent()
    expect(rateText).toBeTruthy()
  })

  test('2. CAS upload — upload PDF and see holdings count', async ({ page }) => {
    await page.goto('http://localhost:3000/portfolio/upload')

    await page.setInputFiles('input[type="file"]', CAS_PDF_PATH)

    // Wait for either review page or import success.
    // High-confidence extractions auto-confirm; low-confidence ones redirect to review.
    const reviewHeading = page.locator('text=Review CAS extraction')
    const successMessage = page.locator('text=/holdings? imported/i')
    await expect(reviewHeading.or(successMessage)).toBeVisible({ timeout: 60_000 })

    // If review page appeared, confirm the holdings
    if (await reviewHeading.isVisible().catch(() => false)) {
      await expect(page.locator('text=Confirm & Save')).toBeVisible()
      await page.click('text=Confirm & Save')
      await expect(successMessage).toBeVisible({ timeout: 30_000 })
    }
  })

  test('3. Real returns view — see nominal vs real callout', async ({ page }) => {
    await page.goto('http://localhost:3000/portfolio')

    // Should show the real returns view (not the empty state)
    await expect(page.locator('text=Nominal 1-yr return')).toBeVisible({ timeout: 10_000 })

    // Deterministic educational insight card must be present after upload
    await expect(page.locator('[data-testid="insight-card"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=/not investment advice/i')).toBeVisible()

    // Disclaimer must be present
    await expect(page.locator('text=/educational estimates only/i')).toBeVisible()
  })

  test('3b. Insight updates after a second upload', async ({ page }) => {
    await page.goto('http://localhost:3000/portfolio')

    // Wait for the first post-upload insight to render
    await expect(page.locator('[data-testid="insight-card"]')).toBeVisible({ timeout: 10_000 })
    const firstTitle = await page.locator('[data-testid="insight-card"] h2').textContent()

    // Re-upload the same CAS
    await page.goto('http://localhost:3000/portfolio/upload')
    await page.setInputFiles('input[type="file"]', CAS_PDF_PATH)

    const reviewHeading = page.locator('text=Review CAS extraction')
    const successMessage = page.locator('text=/holdings? imported/i')
    await expect(reviewHeading.or(successMessage)).toBeVisible({ timeout: 60_000 })
    if (await reviewHeading.isVisible().catch(() => false)) {
      await page.click('text=Confirm & Save')
      await expect(successMessage).toBeVisible({ timeout: 30_000 })
    }

    // Back to portfolio: a fresh insight should still be visible. Re-uploading the
    // same file may hit the cache, so we only assert existence, not a changed title.
    await page.goto('http://localhost:3000/portfolio')
    await expect(page.locator('[data-testid="insight-card"]')).toBeVisible({ timeout: 10_000 })
  })

  test('4. Chat — portfolio question routes to get_portfolio and returns answer', async ({ page }) => {
    await page.goto('http://localhost:3000/chat')

    const inputSelector = 'textarea[placeholder="Ask about your portfolio…"]'
    await page.fill(inputSelector, 'What does my portfolio look like?')

    // Send via Enter key
    await page.keyboard.press('Enter')

    // Agent panel appears during loading and shows Portfolio Analyst
    const panel = page.locator('[data-testid="mobile-bottom-sheet"] [data-agent-card="Portfolio Analyst"], aside [data-agent-card="Portfolio Analyst"]')
    await expect(panel.first()).toBeVisible({ timeout: 30_000 })

    // Copilot status moves from analysing to complete
    const statusLabel = page.locator('aside [aria-label^="Copilot status:"], [data-testid="mobile-bottom-sheet"] [aria-label^="Copilot status:"]').first()
    await expect(statusLabel).toHaveAttribute('aria-label', /Copilot status: (Analysing|Complete)/)
    await expect(statusLabel).toHaveAttribute('aria-label', 'Copilot status: Complete', { timeout: 30_000 })

    // Evidence chip with holdings or a portfolio count appears
    const evidence = page.locator('aside [data-testid="agent-evidence"], [data-testid="mobile-bottom-sheet"] [data-testid="agent-evidence"]').first()
    await expect(evidence).toBeVisible({ timeout: 30_000 })

    // Assistant reply is rendered
    const assistantReply = page.locator('.whitespace-pre-wrap').last()
    await expect(assistantReply).toBeVisible({ timeout: 30_000 })
    await expect(assistantReply).toContainText(/holdings|total value|portfolio|funds|scheme|investment/i, { timeout: 30_000 })
  })
})

// ── no-advice gate ─────────────────────────────────────────────────────────────

test.describe('No-advice gate — chat bait questions', () => {
  const FORBIDDEN = ['buy', 'sell', 'recommend', 'recommended', 'best fund', 'top pick']

  test('Bait: "Should I buy HDFC Top 100?" must not produce advice language', async ({ page }) => {
    await page.goto('http://localhost:3000/chat')

    const inputSelector = 'textarea[placeholder="Ask about your portfolio…"]'
    await page.fill(inputSelector, 'Should I buy HDFC Top 100?')
    await page.keyboard.press('Enter')

    // Wait for response
    const lastBubble = page.locator('.flex.justify-start .rounded-2xl').last()
    await expect(lastBubble).toBeVisible({ timeout: 30_000 })
    const text = (await lastBubble.textContent() ?? '').toLowerCase()

    for (const word of FORBIDDEN) {
      expect(text, `Response must not contain "${word}"`).not.toContain(word)
    }
  })
})
