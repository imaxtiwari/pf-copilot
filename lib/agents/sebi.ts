import { randomUUID } from 'crypto'
import { getGpt4o } from '../azure-openai'
import { SEBI_COMPLIANCE_PROMPT } from '../prompts/sebi-compliance'
import { PortfolioDraft } from './types/priya-types'
import * as schema from '../../db/schema'
import logger from '../logger'

export interface SebiUserProfile {
  age?: number
  income?: number
  taxBracket?: number // e.g. 30 for 30%
}

export interface ComplianceReport {
  taxEfficiencyScore: number
  ltcgLiability: number
  stcgLiability: number
  elssGap: {
    applicable: boolean
    currentElssAllocation: number
    recommended80CAllocation: number
    annualTaxSavingOpportunity: number
  }
  sebiComplianceFlags: Array<{
    rule: string
    issue: string
    severity: 'BLOCK' | 'WARN' | 'INFO'
    remediation: string
  }>
  switchingStrategy: Array<{
    exitFund: string
    entryFund: string
    reason: string
    taxImpact: number
    recommendedTiming: 'IMMEDIATE' | 'AFTER_1YR' | 'AFTER_3YR'
  }>
  overallCompliant: boolean
}

export class Sebi {
  constructor(private db: any) { }

  private isEquity(schemeName: string, schemeType?: string | null, sebiCategory?: string | null): boolean {
    const type = (schemeType || sebiCategory || '').toLowerCase()
    if (type.includes('equity') || type.includes('elss')) return true
    if (type.includes('debt') || type.includes('liquid') || type.includes('gilt') || type.includes('money market')) return false

    // Fallback to name keywords
    const name = schemeName.toLowerCase()
    if (
      name.includes('liquid') ||
      name.includes('debt') ||
      name.includes('bond') ||
      name.includes('gilt') ||
      name.includes('short term') ||
      name.includes('money market') ||
      name.includes('treasury') ||
      name.includes('corporate bond')
    ) {
      return false
    }
    return true // default to equity
  }

  private isElss(schemeName: string, sebiCategory?: string | null): boolean {
    const cat = (sebiCategory || '').toLowerCase()
    if (cat.includes('elss') || cat.includes('tax saver') || cat.includes('tax saving')) return true
    const name = schemeName.toLowerCase()
    if (name.includes('elss') || name.includes('tax saver') || name.includes('tax saving')) return true
    return false
  }

  async runComplianceCheck(inputs: {
    userId: string
    pipelineRunId: string
    portfolioDraft: PortfolioDraft
    existingHoldings: any[]
    userProfile: SebiUserProfile
    fundSnapshots: any[]
  }): Promise<ComplianceReport> {
    const { portfolioDraft, existingHoldings, userProfile, fundSnapshots, pipelineRunId } = inputs
    logger.info({ pipelineRunId }, 'SEBI: runComplianceCheck invoked')

    // ── 1. CLASSIFY FUNDS & COMPUTE DETERMINISTIC TAXES ─────────────────────────
    const snapshotMap = new Map<string, any>()
    for (const snap of fundSnapshots) {
      const code = snap.schemeCode || snap.scheme_code
      if (code) snapshotMap.set(code, snap)
    }

    const totalCurrentValue = existingHoldings.reduce(
      (sum, h) => sum + parseFloat(h.marketValue || '0'),
      0
    )

    let stcgLiability = 0
    let debtLtcgLiability = 0
    let equityLtcgGains = 0
    const taxFormulas: string[] = []

    const slabRate = (userProfile.taxBracket ?? 30) / 100

    for (const h of existingHoldings) {
      const currentValue = parseFloat(h.marketValue || '0')
      const units = parseFloat(h.units || '0')
      const currentNav = parseFloat(h.nav || '0')

      // Resolve purchase parameters (default to 30% gain if unspecified)
      const purchaseNav = h.purchaseNav ? parseFloat(h.purchaseNav) : (h.purchasePrice ? parseFloat(h.purchasePrice) : currentNav * 0.7)

      // Resolve purchase date (default to 1.5 years ago)
      let purchaseDate = new Date(Date.now() - 1.5 * 365.25 * 24 * 60 * 60 * 1000)
      if (h.purchaseDate) {
        purchaseDate = new Date(h.purchaseDate)
      } else if (h.buyDate) {
        purchaseDate = new Date(h.buyDate)
      }

      const holdingPeriodYears = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      const costBasis = units * purchaseNav
      const gains = Math.max(0, currentValue - costBasis)

      const snap = h.schemeCode ? snapshotMap.get(h.schemeCode) : null
      const isEq = this.isEquity(h.schemeName, snap?.schemeType, snap?.sebiCategory)

      if (isEq) {
        if (holdingPeriodYears < 1.0) {
          // STCG Equity: 15% flat
          const tax = gains * 0.15
          stcgLiability += tax
          taxFormulas.push(
            `Equity STCG for ${h.schemeName}: Gains = ₹${gains.toFixed(2)} (< 1 yr), Tax @ 15% = ₹${tax.toFixed(2)}`
          )
        } else {
          // LTCG Equity: accumulates towards the 1L exemption limit
          equityLtcgGains += gains
          taxFormulas.push(
            `Equity LTCG Gains for ${h.schemeName}: Gains = ₹${gains.toFixed(2)} (>= 1 yr, subject to ₹1L aggregate limit)`
          )
        }
      } else {
        // Debt Fund
        if (holdingPeriodYears < 3.0) {
          // STCG Debt: taxed at slab rate
          const tax = gains * slabRate
          stcgLiability += tax
          taxFormulas.push(
            `Debt STCG for ${h.schemeName}: Gains = ₹${gains.toFixed(2)} (< 3 yr), Tax @ Slab (${(slabRate * 100).toFixed(0)}%) = ₹${tax.toFixed(2)}`
          )
        } else {
          // LTCG Debt: 20% with indexation
          // Assume simplified indexation factor of 5% inflation per year held
          const indexationFactor = Math.pow(1.05, Math.max(3, Math.floor(holdingPeriodYears)))
          const indexedCost = costBasis * indexationFactor
          const indexedGains = Math.max(0, currentValue - indexedCost)
          const tax = indexedGains * 0.20
          debtLtcgLiability += tax
          taxFormulas.push(
            `Debt LTCG for ${h.schemeName}: Gains = ₹${gains.toFixed(2)} (>= 3 yr), Indexed Cost = ₹${indexedCost.toFixed(2)} (factor = ${indexationFactor.toFixed(3)}), Indexed Gains = ₹${indexedGains.toFixed(2)}, Tax @ 20% = ₹${tax.toFixed(2)}`
          )
        }
      }
    }

    // Equity LTCG Liability Calculation: 10% on gains exceeding ₹1L
    const equityLtcgTax = equityLtcgGains > 100000 ? (equityLtcgGains - 100000) * 0.10 : 0
    if (equityLtcgGains > 0) {
      taxFormulas.push(
        `Equity LTCG aggregate: Total Gains = ₹${equityLtcgGains.toFixed(2)}. Taxable = Max(0, Gains - ₹1,000,000) = ₹${Math.max(0, equityLtcgGains - 100000).toFixed(2)}. Tax @ 10% = ₹${equityLtcgTax.toFixed(2)}`
      )
    }
    const ltcgLiability = debtLtcgLiability + equityLtcgTax

    // ── 2. COMPUTE ELSS TAX SAVING GAP ──────────────────────────────────────────
    const applicable = userProfile.taxBracket === 30 || userProfile.taxBracket === 0.3
    const recommendedAllocations = portfolioDraft.fund_allocations || []

    const elssAllocations = recommendedAllocations.filter((fa: any) => {
      const snap = fa.scheme_code ? snapshotMap.get(fa.scheme_code) : null
      return this.isElss(fa.fund_name, snap?.sebiCategory)
    })

    const currentElssAllocation = elssAllocations.reduce((sum, fa: any) => sum + parseFloat(fa.allocation_pct || '0'), 0)

    // Assume total portfolio value as the base for tax saving
    const baseValue = totalCurrentValue > 0 ? totalCurrentValue : 150000
    const currentElssAmount = baseValue * (currentElssAllocation / 100)
    const recommended80CAllocation = 150000
    const remainingElssGap = Math.max(0, recommended80CAllocation - currentElssAmount)
    const annualTaxSavingOpportunity = applicable ? remainingElssGap * 0.30 : 0

    // ── 3. COMPUTE TAX EFFICIENCY SCORE ─────────────────────────────────────────
    // Start with 100.
    // Deduct points proportional to the tax liability over the portfolio value.
    let score = 100
    if (totalCurrentValue > 0) {
      const stcgPctOfPortfolio = (stcgLiability / totalCurrentValue) * 100
      const ltcgPctOfPortfolio = (ltcgLiability / totalCurrentValue) * 100
      score -= stcgPctOfPortfolio * 1.5 // STCG hurts score more
      score -= ltcgPctOfPortfolio * 0.5 // LTCG hurts score less
    }
    if (applicable && remainingElssGap > 0) {
      // Deduct up to 20 points for missing the ELSS tax saving opportunity
      score -= (remainingElssGap / recommended80CAllocation) * 20
    }
    const taxEfficiencyScore = Math.max(0, Math.min(100, Math.round(score)))

    // ── 4. RUN GPT-4o FOR COMPLIANCE FLAGS & SWITCHING STRATEGY ─────────────────
    const gpt = getGpt4o()
    const prompt = `
Analyze compliance and switches for the following portfolio draft.

User Profile:
- Age: ${userProfile.age ?? 'Unknown'}
- Tax Bracket: ${userProfile.taxBracket ?? '30'}%
- Annual Income: ₹${userProfile.income?.toLocaleString('en-IN') ?? 'Unknown'}

Existing Holdings:
${JSON.stringify(
      existingHoldings.map(h => ({
        name: h.schemeName,
        value: h.marketValue,
        units: h.units,
        nav: h.nav
      })),
      null,
      2
    )}

Recommended Portfolio Draft:
${JSON.stringify(portfolioDraft, null, 2)}

Deterministic Calculations Performed by System (You MUST output these values exactly):
- taxEfficiencyScore: ${taxEfficiencyScore}
- ltcgLiability: ${ltcgLiability}
- stcgLiability: ${stcgLiability}
- elssGap: {
    "applicable": ${applicable},
    "currentElssAllocation": ${currentElssAllocation},
    "recommended80CAllocation": ${recommended80CAllocation},
    "annualTaxSavingOpportunity": ${annualTaxSavingOpportunity}
  }

Tax Calculation Formulas & Steps:
${taxFormulas.join('\n')}

Instructions:
1. Review the recommended allocations against SEBI's regulations:
   - Diversification constraints: Retail portfolios should limit concentration (e.g., no single AMC > 40%, no single fund > 25% allocation except index funds).
   - Expense Ratio caps: Active equity/debt funds should have expense ratios < 1.5%, index/ETF < 0.5%. (Look at snapshots if available).
   - Category validation: Recommending small cap or high-risk funds to conservative or elder profiles should be flagged.
2. For every compliance flag raised, you MUST cite the specific SEBI rule, circular, or regulatory standard (e.g., SEBI Circular SEBI/HO/IMD/DF3/CIR/P/2020/229).
3. Draft a precise switching strategy for existing holdings to recommended holdings. Specify exit fund, entry fund, timing (IMMEDIATE, AFTER_1YR, or AFTER_3YR based on lock-ins/tax optimization), reason, and the tax impact.
4. Set overallCompliant to false ONLY if there is any flag with severity: "BLOCK".
5. Return ONLY a valid JSON object matching the output schema. No markdown backticks.

JSON Schema:
{
  "sebiComplianceFlags": [
    {
      "rule": string, // Cite SEBI Circular or Rule
      "issue": string, // Describe violation
      "severity": "BLOCK" | "WARN" | "INFO",
      "remediation": string
    }
  ],
  "switchingStrategy": [
    {
      "exitFund": string,
      "entryFund": string,
      "reason": string,
      "taxImpact": number,
      "recommendedTiming": "IMMEDIATE" | "AFTER_1YR" | "AFTER_3YR"
    }
  ],
  "overallCompliant": boolean
}
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SEBI_COMPLIANCE_PROMPT.text },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || '{}'
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const finalReport: ComplianceReport = {
      taxEfficiencyScore,
      ltcgLiability,
      stcgLiability,
      elssGap: {
        applicable,
        currentElssAllocation,
        recommended80CAllocation,
        annualTaxSavingOpportunity
      },
      sebiComplianceFlags: parsed.sebiComplianceFlags || [],
      switchingStrategy: parsed.switchingStrategy || [],
      overallCompliant: parsed.overallCompliant ?? true
    }

    // Double check: if there's any BLOCK flag, overallCompliant must be false
    if (finalReport.sebiComplianceFlags.some(f => f.severity === 'BLOCK')) {
      finalReport.overallCompliant = false
    }

    // Save compliance report to db
    await this.db.insert(schema.complianceReports).values({
      id: randomUUID(),
      pipelineRunId,
      userId: portfolioDraft.client_id || inputs.userId,
      report: finalReport,
      overallCompliant: finalReport.overallCompliant,
      taxEfficiencyScore: finalReport.taxEfficiencyScore,
      generatedAt: new Date()
    }).onConflictDoUpdate({
      target: schema.complianceReports.pipelineRunId,
      set: {
        report: finalReport,
        overallCompliant: finalReport.overallCompliant,
        taxEfficiencyScore: finalReport.taxEfficiencyScore,
        generatedAt: new Date()
      }
    })

    logger.info({ pipelineRunId, overallCompliant: finalReport.overallCompliant }, 'SEBI: compliance check completed and saved')

    return finalReport
  }
}
