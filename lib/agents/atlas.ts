import { eq } from 'drizzle-orm'
import { getGpt4oMini } from '../azure-openai'
import * as schema from '../../db/schema'
import { ATLAS_SYSTEM_PROMPT } from '../prompts/atlas-comparison'
import logger from '../logger'

export interface ComparisonReport {
  overlapAnalysis: {
    overlapPercentage: number
    sharedFunds: string[]
    newFunds: string[]
    exitFunds: string[]
  }
  costAnalysis: {
    currentWeightedExpenseRatio: number
    recommendedWeightedExpenseRatio: number
    annualSavingsEstimate: number
  }
  returnAnalysis: {
    currentPortfolio3YrReturn: number
    recommendedPortfolio3YrReturn: number
    alphaVsBenchmark: number
  }
  consolidationInsight: string
  switchingCost: {
    estimatedExitLoad: number
    stcgLiability: number
    ltcgLiability: number
    recommendedSwitchOrder: string[]
  }
  topInsights: string[]
  generatedAt: string
}

export class Atlas {
  constructor(private db: any) {}

  async generateReport(
    userId: string,
    pipelineRunId: string,
    approvedPortfolio: any,
    existingHoldings: any[],
    fundSnapshots: any[]
  ): Promise<ComparisonReport> {
    logger.info({ pipelineRunId, userId }, 'ATLAS: Generating comparison report')

    // 1. Calculate total market value of current holdings
    const totalCurrentValue = existingHoldings.reduce(
      (sum, h) => sum + parseFloat(h.marketValue || '0'),
      0
    )

    // 2. Map current holdings weights
    const currentWeights = new Map<string, number>()
    const holdingNamesMap = new Map<string, string>() // normalized key -> original name
    for (const h of existingHoldings) {
      const key = (h.schemeCode || h.schemeName || '').trim().toLowerCase()
      const wt = totalCurrentValue > 0 ? parseFloat(h.marketValue || '0') / totalCurrentValue : 0
      currentWeights.set(key, (currentWeights.get(key) || 0) + wt)
      holdingNamesMap.set((h.schemeName || '').trim().toLowerCase(), h.schemeName)
    }

    // 3. Map recommended allocations weights
    const allocations = (approvedPortfolio.fund_allocations || approvedPortfolio.fundAllocations || []) as any[]
    const recommendedWeights = new Map<string, number>()
    const recommendedNamesMap = new Map<string, string>() // normalized key -> original name
    for (const a of allocations) {
      const key = (a.scheme_code || a.schemeCode || a.fund_name || a.fundName || '').trim().toLowerCase()
      const wt = parseFloat(a.allocation_pct || a.allocationPct || '0') / 100
      recommendedWeights.set(key, (recommendedWeights.get(key) || 0) + wt)
      recommendedNamesMap.set(((a.fund_name || a.fundName || '')).trim().toLowerCase(), a.fund_name || a.fundName)
    }

    // 4. Overlap percentage: sum of min(currentWeight, recommendedWeight)
    let overlapFraction = 0
    const allKeys = new Set([...currentWeights.keys(), ...recommendedWeights.keys()])
    for (const key of allKeys) {
      const cWt = currentWeights.get(key) || 0
      const rWt = recommendedWeights.get(key) || 0
      overlapFraction += Math.min(cWt, rWt)
    }
    const overlapPercentage = parseFloat((overlapFraction * 100).toFixed(2))

    // 5. Categorize shared, new, and exit funds
    const sharedFunds: string[] = []
    const newFunds: string[] = []
    const exitFunds: string[] = []

    const currentNames = new Set(existingHoldings.map(h => (h.schemeName || '').trim().toLowerCase()))
    const recommendedNames = new Set(allocations.map((a: any) => (a.fund_name || a.fundName || '').trim().toLowerCase()))

    const sharedSet = new Set<string>()
    const newSet = new Set<string>()
    const exitSet = new Set<string>()

    for (const h of existingHoldings) {
      const name = (h.schemeName || '').trim()
      const lowerName = name.toLowerCase()
      if (recommendedNames.has(lowerName)) {
        if (!sharedSet.has(lowerName)) {
          sharedSet.add(lowerName)
          sharedFunds.push(name)
        }
      } else {
        if (!exitSet.has(lowerName)) {
          exitSet.add(lowerName)
          exitFunds.push(name)
        }
      }
    }

    for (const a of allocations) {
      const name = (a.fund_name || a.fundName || '').trim()
      const lowerName = name.toLowerCase()
      if (!currentNames.has(lowerName)) {
        if (!newSet.has(lowerName)) {
          newSet.add(lowerName)
          newFunds.push(name)
        }
      }
    }

    // 6. Map latest snapshot per scheme code
    const snapshotMap = new Map<string, any>()
    for (const snap of fundSnapshots) {
      const code = snap.schemeCode || snap.scheme_code
      if (code) {
        const existing = snapshotMap.get(code)
        const snapDate = snap.snapshotDate || snap.snapshot_date
        const existingDate = existing ? (existing.snapshotDate || existing.snapshot_date) : null
        if (!existing || (snapDate && existingDate && new Date(snapDate) > new Date(existingDate))) {
          snapshotMap.set(code, snap)
        }
      }
    }

    // 7. Calculate expense ratios
    let currentWeightedER = 0
    let currentERWeightSum = 0
    for (const h of existingHoldings) {
      const code = h.schemeCode
      const wt = totalCurrentValue > 0 ? parseFloat(h.marketValue || '0') / totalCurrentValue : 0
      const snap = code ? snapshotMap.get(code) : null
      const er = snap ? parseFloat(snap.expenseRatio || snap.expense_ratio || '0') : 0
      currentWeightedER += wt * er
      currentERWeightSum += wt
    }
    if (currentERWeightSum > 0) {
      currentWeightedER = currentWeightedER / currentERWeightSum
    }

    let recommendedWeightedER = 0
    let recommendedERWeightSum = 0
    for (const a of allocations) {
      const code = a.scheme_code || a.schemeCode
      const wt = parseFloat(a.allocation_pct || a.allocationPct || '0') / 100
      const snap = code ? snapshotMap.get(code) : null
      const er = snap ? parseFloat(snap.expenseRatio || snap.expense_ratio || '0') : 0
      recommendedWeightedER += wt * er
      recommendedERWeightSum += wt
    }
    if (recommendedERWeightSum > 0) {
      recommendedWeightedER = recommendedWeightedER / recommendedERWeightSum
    }

    const erDelta = (currentWeightedER - recommendedWeightedER) / 100
    const annualSavingsEstimate = Math.max(0, totalCurrentValue * erDelta)

    // 8. Calculate returns
    let currentPortfolio3YrReturn = 0
    let currentReturnWeightSum = 0
    for (const h of existingHoldings) {
      const code = h.schemeCode
      const wt = totalCurrentValue > 0 ? parseFloat(h.marketValue || '0') / totalCurrentValue : 0
      const snap = code ? snapshotMap.get(code) : null
      const r3y = snap ? parseFloat(snap.return3y || snap.return_3y || '0') : 0
      currentPortfolio3YrReturn += wt * r3y
      currentReturnWeightSum += wt
    }
    if (currentReturnWeightSum > 0) {
      currentPortfolio3YrReturn = currentPortfolio3YrReturn / currentReturnWeightSum
    }

    let recommendedPortfolio3YrReturn = 0
    let recommendedReturnWeightSum = 0
    let recommendedAlphaSum = 0
    for (const a of allocations) {
      const code = a.scheme_code || a.schemeCode
      const wt = parseFloat(a.allocation_pct || a.allocationPct || '0') / 100
      const snap = code ? snapshotMap.get(code) : null
      const r3y = snap ? parseFloat(snap.return3y || snap.return_3y || '0') : 0
      const alpha = snap ? parseFloat(snap.alpha3y || snap.alpha_3y || '0') : 0
      recommendedPortfolio3YrReturn += wt * r3y
      recommendedAlphaSum += wt * alpha
      recommendedReturnWeightSum += wt
    }
    if (recommendedReturnWeightSum > 0) {
      recommendedPortfolio3YrReturn = recommendedPortfolio3YrReturn / recommendedReturnWeightSum
      recommendedAlphaSum = recommendedAlphaSum / recommendedReturnWeightSum
    }

    const alphaVsBenchmark = recommendedAlphaSum

    // 9. Switching Costs (Tax & exit load heuristics)
    let totalSellAmount = 0
    for (const h of existingHoldings) {
      const key = (h.schemeCode || h.schemeName || '').trim().toLowerCase()
      const rWt = recommendedWeights.get(key) || 0
      const targetVal = rWt * totalCurrentValue
      const currentVal = parseFloat(h.marketValue || '0')
      const sellAmt = Math.max(0, currentVal - targetVal)
      totalSellAmount += sellAmt
    }

    const estimatedExitLoad = parseFloat((totalSellAmount * 0.10 * 0.01).toFixed(2))
    const stcgLiability = parseFloat((totalSellAmount * 0.20 * 0.10 * 0.20).toFixed(2))
    const ltcgLiability = parseFloat((totalSellAmount * 0.20 * 0.90 * 0.125).toFixed(2))

    // 10. Invoke GPT-4o-mini for structured comparison comments & recommendedSwitchOrder
    const gpt = getGpt4oMini()
    const prompt = `You are comparing a client's current portfolio against a newly approved recommended portfolio.
Here are the calculated metrics:

1. Overlap Analysis:
   - Overlap Percentage: ${overlapPercentage.toFixed(2)}%
   - Shared Funds: ${JSON.stringify(sharedFunds)}
   - New Funds: ${JSON.stringify(newFunds)}
   - Exit Funds: ${JSON.stringify(exitFunds)}

2. Cost Analysis:
   - Current Weighted Expense Ratio: ${currentWeightedER.toFixed(3)}%
   - Recommended Weighted Expense Ratio: ${recommendedWeightedER.toFixed(3)}%
   - Annual Savings Estimate: ₹${annualSavingsEstimate.toFixed(2)}

3. Return Analysis:
   - Current Portfolio 3-Year Return: ${currentPortfolio3YrReturn.toFixed(2)}%
   - Recommended Portfolio 3-Year Return: ${recommendedPortfolio3YrReturn.toFixed(2)}%
   - Recommended Portfolio Alpha: ${alphaVsBenchmark.toFixed(2)}%

4. Switching Cost Heuristics:
   - Estimated Exit Load: ₹${estimatedExitLoad.toFixed(2)}
   - STCG Liability: ₹${stcgLiability.toFixed(2)}
   - LTCG Liability: ₹${ltcgLiability.toFixed(2)}

Client Current Holdings details:
${JSON.stringify(
  existingHoldings.map(h => ({
    name: h.schemeName,
    value: h.marketValue,
    er: snapshotMap.get(h.schemeCode)?.expenseRatio
  })),
  null,
  2
)}

Recommended Portfolio details:
${JSON.stringify(
  allocations.map((a: any) => ({
    name: a.fund_name || a.fundName,
    pct: a.allocation_pct || a.allocationPct,
    er: snapshotMap.get(a.scheme_code || a.schemeCode)?.expenseRatio
  })),
  null,
  2
)}

Generate the required JSON output containing "consolidationInsight", "switchingCost.recommendedSwitchOrder" (exiting high-expense ratio or full-exit funds first), and "topInsights" (exactly 3 bullet points, retail-investor friendly, plain language, using actual rupees and percentages).
Make sure to cite the fund_snapshots table for every return/expense metric mentioned.`;

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ATLAS_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })

    const rawText = response.choices[0]?.message?.content?.trim() || '{}'
    const parsed = JSON.parse(rawText)

    const report: ComparisonReport = {
      overlapAnalysis: {
        overlapPercentage,
        sharedFunds,
        newFunds,
        exitFunds
      },
      costAnalysis: {
        currentWeightedExpenseRatio: parseFloat(currentWeightedER.toFixed(3)),
        recommendedWeightedExpenseRatio: parseFloat(recommendedWeightedER.toFixed(3)),
        annualSavingsEstimate: parseFloat(annualSavingsEstimate.toFixed(2))
      },
      returnAnalysis: {
        currentPortfolio3YrReturn: parseFloat(currentPortfolio3YrReturn.toFixed(2)),
        recommendedPortfolio3YrReturn: parseFloat(recommendedPortfolio3YrReturn.toFixed(2)),
        alphaVsBenchmark: parseFloat(alphaVsBenchmark.toFixed(2))
      },
      consolidationInsight: parsed.consolidationInsight || `You hold ${existingHoldings.length} funds with ${overlapPercentage.toFixed(0)}% overlap — this consolidates to ${allocations.length}.`,
      switchingCost: {
        estimatedExitLoad,
        stcgLiability,
        ltcgLiability,
        recommendedSwitchOrder: parsed.switchingCost?.recommendedSwitchOrder || exitFunds
      },
      topInsights: parsed.topInsights || [
        `By switching to the recommended portfolio, you can save ₹${annualSavingsEstimate.toLocaleString('en-IN', { maximumFractionDigits: 0 })} annually in expense fees.`,
        `Your estimated returns will improve from ${currentPortfolio3YrReturn.toFixed(2)}% to ${recommendedPortfolio3YrReturn.toFixed(2)}%.`,
        `This switch consolidates your holdings, reducing the number of funds and eliminating unnecessary overlap.`
      ],
      generatedAt: new Date().toISOString()
    }

    // Save report to db
    await this.db.insert(schema.comparisonReports).values({
      pipelineRunId,
      userId,
      report,
      generatedAt: new Date()
    }).onConflictDoUpdate({
      target: schema.comparisonReports.pipelineRunId,
      set: { report, generatedAt: new Date() }
    })

    logger.info({ pipelineRunId }, 'ATLAS: Comparison report generated and saved successfully')

    return report
  }
}
