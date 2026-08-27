import { getGpt4oMini } from '@/lib/azure-openai'
import * as schema from '@/db/schema'
import { ATLAS_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'
import logger from '@/lib/logger'

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

/**
 * ATLAS — Automated Tracking & Learning Across Schemes.
 *
 * Compares existing holdings to a hypothetical portfolio draft for educational
 * discussion. Does not recommend switches.
 */
export class Atlas {
  constructor(private db: any) {}

  async generateReport(
    userId: string,
    pipelineRunId: string,
    approvedPortfolio: any,
    existingHoldings: any[],
    fundSnapshots: any[],
  ): Promise<ComparisonReport> {
    logger.info({ pipelineRunId, userId }, 'ATLAS: Generating comparison report')

    const totalCurrentValue = existingHoldings.reduce((sum, h) => sum + parseFloat(h.marketValue || '0'), 0)

    const currentWeights = new Map<string, number>()
    const holdingNamesMap = new Map<string, string>()
    for (const h of existingHoldings) {
      const key = (h.schemeCode || h.schemeName || '').trim().toLowerCase()
      const wt = totalCurrentValue > 0 ? parseFloat(h.marketValue || '0') / totalCurrentValue : 0
      currentWeights.set(key, (currentWeights.get(key) || 0) + wt)
      holdingNamesMap.set((h.schemeName || '').trim().toLowerCase(), h.schemeName)
    }

    const allocations = (approvedPortfolio.fund_allocations || approvedPortfolio.fundAllocations || []) as any[]
    const recommendedWeights = new Map<string, number>()
    const recommendedNamesMap = new Map<string, string>()
    for (const a of allocations) {
      const key = (a.scheme_code || a.schemeCode || a.fund_name || a.fundName || '').trim().toLowerCase()
      const wt = parseFloat(a.allocation_pct || a.allocationPct || '0') / 100
      recommendedWeights.set(key, (recommendedWeights.get(key) || 0) + wt)
      recommendedNamesMap.set((a.fund_name || a.fundName || '').trim().toLowerCase(), a.fund_name || a.fundName)
    }

    let overlapFraction = 0
    const allKeys = new Set([...currentWeights.keys(), ...recommendedWeights.keys()])
    for (const key of allKeys) {
      const cWt = currentWeights.get(key) || 0
      const rWt = recommendedWeights.get(key) || 0
      overlapFraction += Math.min(cWt, rWt)
    }
    const overlapPercentage = parseFloat((overlapFraction * 100).toFixed(2))

    const sharedFunds: string[] = []
    const newFunds: string[] = []
    const exitFunds: string[] = []

    const currentNames = new Set(existingHoldings.map((h) => (h.schemeName || '').trim().toLowerCase()))
    const recommendedNames = new Set(allocations.map((a: any) => (a.fund_name || a.fundName || '').trim().toLowerCase()))

    for (const name of recommendedNames) {
      if (currentNames.has(name)) sharedFunds.push(recommendedNamesMap.get(name) || name)
      else newFunds.push(recommendedNamesMap.get(name) || name)
    }
    for (const name of currentNames) {
      if (!recommendedNames.has(name)) exitFunds.push(holdingNamesMap.get(name) || name)
    }

    const snapshotMap = new Map<string, any>()
    for (const snap of fundSnapshots) {
      const code = snap.schemeCode || snap.scheme_code
      if (code) snapshotMap.set(code, snap)
    }

    let currentWeightedER = 0
    let recommendedWeightedER = 0
    let currentPortfolio3YrReturn = 0
    let recommendedPortfolio3YrReturn = 0

    for (const h of existingHoldings) {
      const code = h.schemeCode
      const wt = totalCurrentValue > 0 ? parseFloat(h.marketValue || '0') / totalCurrentValue : 0
      const snap = snapshotMap.get(code)
      const er = parseFloat(snap?.expenseRatio || '0')
      const ret3y = parseFloat(snap?.return3y || snap?.return_3y || '0')
      currentWeightedER += wt * er
      currentPortfolio3YrReturn += wt * ret3y
    }

    for (const a of allocations) {
      const code = a.scheme_code || a.schemeCode
      const wt = parseFloat(a.allocation_pct || a.allocationPct || '0') / 100
      const snap = snapshotMap.get(code)
      const er = parseFloat(snap?.expenseRatio || '0')
      const ret3y = parseFloat(snap?.return3y || snap?.return_3y || '0')
      recommendedWeightedER += wt * er
      recommendedPortfolio3YrReturn += wt * ret3y
    }

    const annualSavingsEstimate = totalCurrentValue * (currentWeightedER - recommendedWeightedER) / 100
    const alphaVsBenchmark = recommendedPortfolio3YrReturn - currentPortfolio3YrReturn

    const estimatedExitLoad = 0
    const stcgLiability = 0
    const ltcgLiability = 0

    const prompt = `
You are ATLAS. Generate a portfolio comparison for educational discussion.

Overlap Analysis:
- Overlap: ${overlapPercentage}%
- Shared funds: ${sharedFunds.join(', ')}
- New funds: ${newFunds.join(', ')}
- Exit funds: ${exitFunds.join(', ')}

Cost Analysis:
- Current weighted expense ratio: ${currentWeightedER.toFixed(3)}%
- Recommended weighted expense ratio: ${recommendedWeightedER.toFixed(3)}%
- Estimated annual fee savings: ₹${annualSavingsEstimate.toFixed(2)}

Return Analysis (3-year, hypothetical, for discussion):
- Current portfolio 3Y return: ${currentPortfolio3YrReturn.toFixed(2)}%
- Recommended portfolio 3Y return: ${recommendedPortfolio3YrReturn.toFixed(2)}%
- Alpha vs current: ${alphaVsBenchmark.toFixed(2)}%

Generate the required JSON output containing "consolidationInsight", "switchingCost.recommendedSwitchOrder", and "topInsights" (exactly 3 bullet points, retail-investor friendly, plain language, using actual rupees and percentages).
Frame everything as discussion, not advice.
`

    const response = await getGpt4oMini().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ATLAS_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || '{}'
    const parsed = JSON.parse(rawText)

    const report: ComparisonReport = {
      overlapAnalysis: {
        overlapPercentage,
        sharedFunds,
        newFunds,
        exitFunds,
      },
      costAnalysis: {
        currentWeightedExpenseRatio: parseFloat(currentWeightedER.toFixed(3)),
        recommendedWeightedExpenseRatio: parseFloat(recommendedWeightedER.toFixed(3)),
        annualSavingsEstimate: parseFloat(annualSavingsEstimate.toFixed(2)),
      },
      returnAnalysis: {
        currentPortfolio3YrReturn: parseFloat(currentPortfolio3YrReturn.toFixed(2)),
        recommendedPortfolio3YrReturn: parseFloat(recommendedPortfolio3YrReturn.toFixed(2)),
        alphaVsBenchmark: parseFloat(alphaVsBenchmark.toFixed(2)),
      },
      consolidationInsight:
        parsed.consolidationInsight ||
        `You hold ${existingHoldings.length} funds with ${overlapPercentage.toFixed(0)}% overlap — this consolidates to ${allocations.length} for discussion.`,
      switchingCost: {
        estimatedExitLoad,
        stcgLiability,
        ltcgLiability,
        recommendedSwitchOrder: parsed.switchingCost?.recommendedSwitchOrder || exitFunds,
      },
      topInsights: parsed.topInsights || [
        `By switching to the recommended portfolio for discussion, you could save ₹${annualSavingsEstimate.toLocaleString('en-IN', { maximumFractionDigits: 0 })} annually in expense fees.`,
        `Your estimated 3-year returns would change from ${currentPortfolio3YrReturn.toFixed(2)}% to ${recommendedPortfolio3YrReturn.toFixed(2)}% (hypothetical).`,
        `This switch would consolidate your holdings, reducing the number of funds and eliminating unnecessary overlap.`,
      ],
      generatedAt: new Date().toISOString(),
    }

    await this.db
      .insert(schema.comparisonReports)
      .values({
        pipelineRunId,
        userId,
        report,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.comparisonReports.pipelineRunId,
        set: { report, generatedAt: new Date() },
      })

    logger.info({ pipelineRunId }, 'ATLAS: Comparison report generated and saved successfully')

    return report
  }
}
