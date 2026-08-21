import { test, expect } from '@playwright/test'

test.describe('E2E Advisory Pipeline Happy Path', () => {
  test('should execute full advisory pipeline via APIs after onboarding', async ({ page }) => {
    // 1. Onboarding Form Submission
    await page.goto('/onboarding')

    // Fill the onboarding form
    await page.fill('input[placeholder="e.g. 35"]', '35')
    await page.check('input[name="city_tier"][value="metro"]')
    await page.check('input[name="living"][value="rent"]')
    await page.fill('input[placeholder="Monthly rent"]', '25000')
    await page.check('input[name="dependents"][value="spouse"]')
    await page.check('input[name="medical"][value="none"]')

    // Submit the form
    await page.click('button[type="submit"]')

    // Wait for onboarding to complete and show results page
    await expect(page.locator('text=Your personal inflation rate')).toBeVisible({ timeout: 15_000 })

    // 2. Start the advisory pipeline via POST /api/pipeline/start
    const startResult = await page.evaluate(async () => {
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_data: {
            age: 35,
            city_tier: 'metro',
            monthly_rent: 25000,
            owns_home: false,
            dependents: 'spouse',
            medical_conditions: false
          }
        })
      })
      if (!res.ok) {
        throw new Error(`Failed to start pipeline: ${res.statusText}`)
      }
      return res.json()
    })

    expect(startResult.status).toBe('STARTED')
    expect(startResult.pipeline_run_id).toBeDefined()
    const runId = startResult.pipeline_run_id
    console.log(`[E2E] Pipeline started. runId: ${runId}`)

    // 3. Poll GET /api/pipeline/[runId]/status until stage is VIKRAM_INTERVIEW (max 120s)
    let stage = ''
    let status = ''
    const startTime = Date.now()
    while (Date.now() - startTime < 120_000) {
      const statusRes = await page.evaluate(async (rid) => {
        const res = await fetch(`/api/pipeline/${rid}/status`)
        return res.json()
      }, runId)
      stage = statusRes.current_stage
      status = statusRes.status
      console.log(`[E2E] Polling status: ${JSON.stringify(statusRes)}`)
      if (stage === 'VIKRAM_INTERVIEW' || status === 'COMPLETED' || status === 'DEADLOCKED') {
        break
      }
      await page.waitForTimeout(1000)
    }
    expect(stage).toBe('VIKRAM_INTERVIEW')

    // 4. Submit Vikram interview answers via POST /api/pipeline/[runId]/interview
    const interviewResult = await page.evaluate(async (rid) => {
      const res = await fetch(`/api/pipeline/${rid}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: {
            monthly_income_lakh: '3.5',
            stated_goals: 'Retirement corpus'
          }
        })
      })
      if (!res.ok) {
        throw new Error(`Failed to submit interview answers: ${res.statusText}`)
      }
      return res.json()
    }, runId)
    expect(interviewResult.stage).toBe('VIKRAM_GOAL_ASSESSMENT')
    console.log(`[E2E] Submitted Vikram interview answers. Stage: ${interviewResult.stage}`)

    // 5. Poll status until status becomes COMPLETED or DEADLOCKED (max 300s)
    const startPollTime = Date.now()
    while (Date.now() - startPollTime < 300_000) {
      const statusRes = await page.evaluate(async (rid) => {
        const res = await fetch(`/api/pipeline/${rid}/status`)
        return res.json()
      }, runId)
      status = statusRes.status
      stage = statusRes.current_stage
      console.log(`[E2E] Polling completion: stage=${stage}, status=${status}`)
      if (status === 'COMPLETED' || status === 'DEADLOCKED' || status === 'FAILED') {
        break
      }
      await page.waitForTimeout(1000)
    }
    expect(['COMPLETED', 'DEADLOCKED']).toContain(status)

    // 6. Get room history via GET /api/pipeline/[runId]/deliberation
    const deliberationHistory = await page.evaluate(async (rid) => {
      const res = await fetch(`/api/pipeline/${rid}/deliberation`)
      return res.json()
    }, runId)
    expect(deliberationHistory.messages).toBeDefined()
    expect(deliberationHistory.total).toBeGreaterThan(0)

    const senders = deliberationHistory.messages.map((m: any) => m.sender)
    expect(senders).toContain('ARIA')
    expect(senders).toContain('KIRAN')
    expect(senders).toContain('VIKRAM')

    // 7. Get final recommendations / results via GET /api/pipeline/[runId]/result
    const finalResult = await page.evaluate(async (rid) => {
      const res = await fetch(`/api/pipeline/${rid}/result`)
      return res.json()
    }, runId)

    // Assert disclaimer text is present
    expect(finalResult.sebi_disclaimer).toContain('SEBI')
    expect(finalResult.backtest_disclaimer).toBeDefined()

    // Assertions specific to successful portfolio generation (APPROVED / COMPLETED) or deadlocked
    if (status === 'COMPLETED') {
      expect(finalResult.packet_id).toBeDefined()
      expect(finalResult.confidence_score_breakdown.total).toBeGreaterThanOrEqual(60)
      expect(finalResult.full_portfolio.fund_allocations.length).toBeGreaterThan(0)
      expect(finalResult.backtest_summary.period_years).toBeGreaterThanOrEqual(5)
    } else {
      // DEADLOCKED
      expect(finalResult.report_id).toBeDefined()
      expect(finalResult.dhruv_compromise_proposal).toBeDefined()
    }
  })
})
