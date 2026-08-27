import { randomUUID } from 'crypto'
import { getGpt4o } from '@/lib/azure-openai'
import { SEBI_COMPLIANCE_PROMPT } from '@/lib/prompts/sebi-compliance'
import * as schema from '@/db/schema'
import logger from '@/lib/logger'

export interface SebiUserProfile {
  age?: number
  income?: number
  taxBracket?: number
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
  disclaimer: string
}

const REQUIRED_DISCLAIMER =
  'This is a hypothetical portfolio for educational discussion only. It is not investment advice, not a recommendation to buy, sell, or switch securities, and not approved by SEBI or any regulatory authority. Past performance does not guarantee future returns. Consult a SEBI-registered investment advisor before making financial decisions.'

/**
 * SEBI — compliance and tax specialist agent.
 *
 * Generates compliance flags and the disclaimer that must appear in every
 * client-facing output.
 */
export class Sebi {
  constructor(private db: any) {}

  private isEquity(schemeName: string, schemeType?: string | null, sebiCategory?: string | null): boolean {
    const type = (schemeType || sebiCategory || '').toLowerCase()
    if (type.includes('equity') || type.includes('elss')) return true
    if (type.includes('debt') || type.includes('liquid') || type.includes('gilt') || type.includes('money market')) return false

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
    return true
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
    portfolioDraft: any
    existingHoldings: any[]
    userProfile: SebiUserProfile
    fundSnapshots: any[]
  }): Promise<ComplianceReport> {
    const { portfolioDraft, existingHoldings, userProfile, fundSnapshots, pipelineRunId } = inputs
    logger.info({ pipelineRunId }, 'SEBI: runComplianceCheck invoked')

    const snapshotMap = new Map<string, any>()
    for (const snap of fundSnapshots) {
      const code = snap.schemeCode || snap.scheme_code
      if (code) snapshotMap.set(code, snap)
    }

    const totalCurrentValue = existingHoldings.reduce((sum, h) => sum + parseFloat(h.marketValue || '0'), 0)

    let stcgLiability = 0
    let debtLtcgLiability = 0
    let equityLtcgGains = 0
    const taxFormulas: string[] = []

    const slabRate = (userProfile.taxBracket ?? 30) / 100

    for (const h of existingHoldings) {
      const currentValue = parseFloat(h.marketValue || '0')
      const costValue = parseFloat(h.costValue || h.investmentValue || '0')
      const gain = currentValue - costValue
      const isEquity = this.isEquity(h.schemeName, h.schemeType, h.sebiCategory)
      const holdingMonths = parseFloat(h.holdingMonths || '12')

      if (gain <= 0) continue

      if (isEquity) {
        if (holdingMonths < 12) {
          const tax = gain * 0.15
          stcgLiability += tax
          taxFormulas.push(`Equity STCG: ₹${gain.toFixed(0)} * 15% = ₹${tax.toFixed(0)} (${h.schemeName})`)
        } else {
          equityLtcgGains += gain
        }
      } else {
        if (holdingMonths < 36) {
          const tax = gain * slabRate
          stcgLiability += tax
          taxFormulas.push(`Debt STCG: ₹${gain.toFixed(0)} * ${(slabRate * 100).toFixed(0)}% = ₹${tax.toFixed(0)} (${h.schemeName})`)
        } else {
          const tax = gain * 0.2
          debtLtcgLiability += tax
          taxFormulas.push(`Debt LTCG (indexation ignored for estimate): ₹${gain.toFixed(0)} * 20% = ₹${tax.toFixed(0)} (${h.schemeName})`)
        }
      }
    }

    const equityLtcgTaxable = Math.max(0, equityLtcgGains - 125000)
    const equityLtcgLiability = equityLtcgTaxable * 0.1
    const ltcgLiability = debtLtcgLiability + equityLtcgLiability

    const allocations = portfolioDraft.fund_allocations || []
    let currentElssAllocation = 0
    let recommendedElssAllocation = 0

    for (const h of existingHoldings) {
      if (this.isElss(h.schemeName, h.sebiCategory)) {
        currentElssAllocation += parseFloat(h.marketValue || '0')
      }
    }
    for (const a of allocations) {
      if (this.isElss(a.fund_name, a.sebi_category)) {
        recommendedElssAllocation += (parseFloat(a.allocation_pct || '0') / 100) * totalCurrentValue
      }
    }

    const applicable = (userProfile.taxBracket ?? 30) >= 20
    const recommended80CAllocation = Math.min(150000, totalCurrentValue * 0.2)
    const annualTaxSavingOpportunity = applicable
      ? (recommended80CAllocation - currentElssAllocation) * slabRate
      : 0

    const taxEfficiencyScore = Math.max(0, Math.min(100, 100 - (stcgLiability + ltcgLiability) / Math.max(totalCurrentValue, 1) * 100))

    const prompt = `
You are SEBI. Review the following hypothetical portfolio draft for discussion points and generate the required disclaimer.

Required Disclaimer (must be included verbatim in output):
"${REQUIRED_DISCLAIMER}"

User Profile:
- Age: ${userProfile.age || 'unknown'}
- Annual Income: ₹${userProfile.income?.toLocaleString('en-IN') || 'unknown'}
- Tax Bracket: ${userProfile.taxBracket ?? 30}%

Existing Holdings:
${JSON.stringify(existingHoldings, null, 2)}

Recommended Portfolio Draft:
${JSON.stringify(portfolioDraft, null, 2)}

Fund Snapshots:
${JSON.stringify(fundSnapshots, null, 2)}

Deterministic Tax Summary (for discussion):
- STCG Liability: ₹${stcgLiability.toFixed(2)}
- LTCG Liability: ₹${ltcgLiability.toFixed(2)}
- ELSS Tax-Saving Opportunity: ₹${annualTaxSavingOpportunity.toFixed(2)}
${taxFormulas.map((f) => `- ${f}`).join('\n')}

Instructions:
1. Review recommended allocations against SEBI's diversification discussion guidelines.
2. Cite specific SEBI rules for every flag.
3. Include the required disclaimer verbatim in the output under the "disclaimer" field.
4. Set overallCompliant to false only if any flag has severity "BLOCK".
5. Return ONLY valid JSON.

JSON Schema:
{
  "sebiComplianceFlags": [{ "rule": string, "issue": string, "severity": "BLOCK" | "WARN" | "INFO", "remediation": string }],
  "switchingStrategy": [{ "exitFund": string, "entryFund": string, "reason": string, "taxImpact": number, "recommendedTiming": "IMMEDIATE" | "AFTER_1YR" | "AFTER_3YR" }],
  "overallCompliant": boolean,
  "disclaimer": string
}
`

    const response = await getGpt4o().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SEBI_COMPLIANCE_PROMPT.text },
        { role: 'user', content: prompt },
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
        annualTaxSavingOpportunity,
      },
      sebiComplianceFlags: parsed.sebiComplianceFlags || [],
      switchingStrategy: parsed.switchingStrategy || [],
      overallCompliant: parsed.overallCompliant ?? true,
      disclaimer: parsed.disclaimer && parsed.disclaimer.length > 0 ? parsed.disclaimer : REQUIRED_DISCLAIMER,
    }

    if (finalReport.sebiComplianceFlags.some((f) => f.severity === 'BLOCK')) {
      finalReport.overallCompliant = false
    }

    await this.db
      .insert(schema.complianceReports)
      .values({
        id: randomUUID(),
        pipelineRunId,
        userId: portfolioDraft.client_id || inputs.userId,
        report: finalReport,
        overallCompliant: finalReport.overallCompliant,
        taxEfficiencyScore: finalReport.taxEfficiencyScore,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.complianceReports.pipelineRunId,
        set: {
          report: finalReport,
          overallCompliant: finalReport.overallCompliant,
          taxEfficiencyScore: finalReport.taxEfficiencyScore,
          generatedAt: new Date(),
        },
      })

    logger.info({ pipelineRunId, overallCompliant: finalReport.overallCompliant }, 'SEBI: compliance check completed and saved')

    return finalReport
  }
}

export { REQUIRED_DISCLAIMER }
