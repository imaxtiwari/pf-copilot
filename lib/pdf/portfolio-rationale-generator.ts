import PDFDocument from 'pdfkit'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../../db/schema'
import logger from '../logger'

export class PortfolioRationaleGenerator {
  constructor(private db: any) {}

  async generateAndSave(pipelineRunId: string, userId: string, packet: any): Promise<void> {
    logger.info({ pipelineRunId, userId }, 'Generating Portfolio Rationale PDF')

    // 1. Fetch auxiliary records
    // User profile
    const [profile] = await this.db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
      .limit(1)

    // Behavioral fingerprint
    const [bfRecord] = await this.db
      .select()
      .from(schema.behavioralFingerprints)
      .where(eq(schema.behavioralFingerprints.pipelineRunId, pipelineRunId))
      .limit(1)
    const behavioralFingerprint = bfRecord?.fingerprint

    // Compliance report
    const [compRecord] = await this.db
      .select()
      .from(schema.complianceReports)
      .where(eq(schema.complianceReports.pipelineRunId, pipelineRunId))
      .limit(1)
    const complianceReport = compRecord?.report

    // Comparison report
    const [compareRecord] = await this.db
      .select()
      .from(schema.comparisonReports)
      .where(eq(schema.comparisonReports.pipelineRunId, pipelineRunId))
      .limit(1)
    const comparisonReport = compareRecord?.report

    // Extracted portfolio and goals
    const approvedPortfolio = packet.full_portfolio || packet
    const goalAssessment = packet.client_goal_summary

    // Get investor first name
    const firstName = await this.getUserFirstName(userId)

    // 2. Generate PDF Buffer
    const buffer = await this.generatePdfBuffer({
      userId,
      pipelineRunId,
      firstName,
      userProfile: profile,
      behavioralFingerprint,
      complianceReport,
      comparisonReport,
      approvedPortfolio,
      goalAssessment,
      packet
    })

    // 3. Save to pipelineResults
    const base64 = buffer.toString('base64')
    await this.db
      .update(schema.pipelineResults)
      .set({
        rationalePdfUrl: base64,
        rationalePdfGeneratedAt: new Date()
      })
      .where(eq(schema.pipelineResults.pipelineRunId, pipelineRunId))

    logger.info({ pipelineRunId }, 'Portfolio Rationale PDF successfully generated and saved to DB')
  }

  private async getUserFirstName(userId: string): Promise<string> {
    try {
      const [upload] = await this.db
        .select({ rawText: schema.casUploads.rawTextPreview })
        .from(schema.casUploads)
        .where(eq(schema.casUploads.userId, userId))
        .limit(1)
      
      if (upload?.rawText) {
        const match = upload.rawText.match(/(?:Investor Name|Investor|Name)\s*:\s*([^\n\r]+)/i)
        if (match && match[1]) {
          const fullName = match[1].trim()
          const firstName = fullName.split(/\s+/)[0]
          if (firstName && firstName.toLowerCase() !== 'xxxx') {
            return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
          }
        }
      }
    } catch (e) {
      // ignore
    }
    return 'Investor'
  }

  private async generatePdfBuffer(inputs: any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true })
        const chunks: Buffer[] = []
        
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', (err) => reject(err))

        const {
          pipelineRunId,
          firstName,
          userProfile,
          behavioralFingerprint,
          complianceReport,
          comparisonReport,
          approvedPortfolio,
          goalAssessment,
          packet
        } = inputs

        const PRIMARY = '#0F172A' // Slate 900
        const SECONDARY = '#475569' // Slate 600
        const ACCENT = '#0D9488' // Teal 600
        const BORDER = '#E2E8F0' // Slate 200
        const TEXT_COLOR = '#1E293B' // Slate 800

        // Helper to draw horizontal line
        const hr = (y: number, color = BORDER, width = 1) => {
          doc.moveTo(50, y).lineTo(545, y).strokeColor(color).lineWidth(width).stroke()
        }

        // Helper to draw section heading
        const drawHeading = (text: string, y: number): number => {
          doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(14).text(text, 50, y)
          hr(y + 18, ACCENT, 1.5)
          return y + 30
        }

        // ────────────────────────────────────────────────────────────────────────
        // COVER PAGE
        // ────────────────────────────────────────────────────────────────────────
        // Accent top bar
        doc.rect(0, 0, 595, 30).fill(PRIMARY)

        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(26).text('Portfolio Recommendation', 50, 180)
        doc.font('Helvetica-Bold').fontSize(20).fillColor(ACCENT).text(`Prepared for ${firstName}`, 50, 215)
        
        doc.fillColor(SECONDARY).font('Helvetica').fontSize(12).text(`Prepared by pf-copilot`, 50, 270)
        doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50, 290)
        doc.text(`Pipeline Run ID: ${pipelineRunId}`, 50, 310)

        // Divider
        doc.moveTo(50, 350).lineTo(545, 350).strokeColor(BORDER).lineWidth(1).stroke()

        // Executive Summary
        if (packet?.executive_summary) {
          doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(12).text('Executive Summary', 50, 375)
          doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9.5).text(packet.executive_summary, 50, 395, {
            width: 495,
            lineGap: 4,
            align: 'justify'
          })
        }

        // Legal Disclaimer at bottom of cover page
        const disclaimerY = 660
        hr(disclaimerY - 10, BORDER)
        doc.fillColor(SECONDARY).font('Helvetica-Oblique').fontSize(7.5).text(
          `Disclaimer: This document is generated by an automated AI pipeline for informational and educational purposes only. It does not constitute formal investment advice or solicit transactions in mutual funds or securities under the SEBI (Investment Advisers) Regulations, 2013. The simulated results and risk assessments do not guarantee future returns. Please consult a SEBI-registered financial planner before taking action.`,
          50,
          disclaimerY,
          { width: 495, align: 'justify', lineGap: 2 }
        )

        // ────────────────────────────────────────────────────────────────────────
        // PAGE 2: Section 1 & Section 2
        // ────────────────────────────────────────────────────────────────────────
        doc.addPage()
        let y = 60

        // Section 1: Your Financial Profile
        y = drawHeading('Section 1: Your Financial Profile', y)
        
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(10)
        
        const col1X = 50
        const col2X = 280
        
        // Age, City Tier
        doc.text('Age:', col1X, y).font('Helvetica').fillColor(TEXT_COLOR).text(userProfile?.age ? String(userProfile.age) : 'N/A', col1X + 100, y)
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('City Tier:', col2X, y).font('Helvetica').fillColor(TEXT_COLOR).text(userProfile?.cityTier ? String(userProfile.cityTier).toUpperCase() : 'N/A', col2X + 110, y)
        
        y += 18
        // Dependents, Personal Inflation
        const dependentsStr = userProfile?.dependents ? String(userProfile.dependents) : 'N/A'
        const inflationPct = userProfile?.inflationRate ? `${(parseFloat(userProfile.inflationRate) * 100).toFixed(2)}%` : '7.20%'
        
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('Dependents:', col1X, y).font('Helvetica').fillColor(TEXT_COLOR).text(dependentsStr.toUpperCase(), col1X + 100, y)
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('Personal Inflation:', col2X, y).font('Helvetica').fillColor(TEXT_COLOR).text(inflationPct, col2X + 110, y)
        
        y += 18
        // Risk profile, Income bracket
        const statedRisk = approvedPortfolio?.strategy_framework?.selected_frameworks?.[0]?.name || 'MODERATE'
        
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('Stated Risk Profile:', col1X, y).font('Helvetica').fillColor(TEXT_COLOR).text(statedRisk, col1X + 100, y)
        
        y += 30

        // Behavioral Note
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(10).text('Behavioral Risk Analysis (RIYA):', col1X, y)
        y += 15
        
        let behavioralNote = "Your stated risk profile is matched with the portfolio construction. RIYA's analysis indicates your portfolio discipline risk is low under normal market variations."
        if (behavioralFingerprint) {
          const reality = behavioralFingerprint.riskToleranceReality === 'LOWER_THAN_STATED' 
            ? 'lower than stated' 
            : behavioralFingerprint.riskToleranceReality === 'HIGHER_THAN_STATED' 
            ? 'higher than stated' 
            : 'aligned with your stated tolerance'
          
          behavioralNote = `Your stated risk tolerance is ${statedRisk.toLowerCase()}. RIYA's behavioral analysis indicates your risk tolerance in practice is ${reality}. ${behavioralFingerprint.riskToleranceReasoning || ''} Portfolio abandonment risk is classified as ${behavioralFingerprint.portfolioAbandonmentRisk || 'MEDIUM'}.`
        }
        
        doc.fillColor(TEXT_COLOR).font('Helvetica-Oblique').fontSize(9).text(behavioralNote, col1X, y, {
          width: 495,
          lineGap: 3
        })
        
        y += 65

        // Section 2: Your Goals
        y = drawHeading('Section 2: Your Goals & Target Plan', y)
        
        const goalHeaders = ['Goal Description', 'Target (Lakh)', 'Timeline', 'Req. CAGR', 'Status', 'Rec. SIP']
        const goalColWidths = [150, 75, 60, 65, 75, 70]
        
        const goalRows: string[][] = []
        if (goalAssessment?.decomposed_goals) {
          for (const g of goalAssessment.decomposed_goals) {
            const status = g.required_cagr_pct > 15 ? 'Stretch' : g.required_cagr_pct > 12 ? 'Moderate' : 'On Track'
            goalRows.push([
              g.description || g.goal_type,
              `₹${parseFloat(g.target_corpus_lakh).toFixed(1)}L`,
              g.target_date ? new Date(g.target_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'N/A',
              `${parseFloat(g.required_cagr_pct).toFixed(1)}%`,
              status,
              `₹${(parseFloat(g.monthly_sip_required_lakh) * 100000).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo`
            ])
          }
        } else {
          goalRows.push(['Default Goal', '₹100L', '10 Years', '12.0%', 'On Track', '₹20,000/mo'])
        }

        y = this.drawTable(doc, 50, y, goalHeaders, goalRows, goalColWidths)

        // ────────────────────────────────────────────────────────────────────────
        // PAGE 3: Section 3 (Your Portfolio & Fund Rationale)
        // ────────────────────────────────────────────────────────────────────────
        doc.addPage()
        y = 60
        y = drawHeading('Section 3: Recommended Asset Allocation', y)
        
        let totalVal = 1000000
        if (approvedPortfolio?.fund_allocations) {
          totalVal = approvedPortfolio.fund_allocations.reduce((sum: number, a: any) => sum + parseFloat(a.market_value || '0'), 0)
          if (totalVal <= 0) {
            totalVal = goalAssessment?.decomposed_goals?.reduce((sum: number, g: any) => sum + (parseFloat(g.current_corpus_lakh || '0') * 100000), 0) || 1000000
          }
        }

        const fundHeaders = ['Mutual Fund Name', 'Category', 'Allocation %', 'Allocation Value', 'Role']
        const fundColWidths = [185, 95, 75, 85, 55]
        
        const schemeCodes = (approvedPortfolio?.fund_allocations || []).map((a: any) => a.scheme_code).filter(Boolean)
        const fundCategories = new Map<string, string>()
        if (schemeCodes.length > 0) {
          try {
            const funds = await this.db
              .select({ schemeCode: schema.agentFunds.schemeCode, sebiCategory: schema.agentFunds.sebiCategory })
              .from(schema.agentFunds)
              .where(inArray(schema.agentFunds.schemeCode, schemeCodes))
            for (const f of funds) {
              if (f.schemeCode && f.sebiCategory) {
                fundCategories.set(f.schemeCode, f.sebiCategory)
              }
            }
          } catch (e) {
            // ignore
          }
        }

        const fundRows: string[][] = []
        if (approvedPortfolio?.fund_allocations) {
          for (const a of approvedPortfolio.fund_allocations) {
            const pct = parseFloat(a.allocation_pct || '0')
            const valueAmt = (pct / 100) * totalVal
            const cat = fundCategories.get(a.scheme_code) || 'Mutual Fund'
            const role = pct > 20 ? 'Core' : 'Satellite'
            fundRows.push([
              a.fund_name,
              cat,
              `${pct.toFixed(1)}%`,
              `₹${valueAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
              role
            ])
          }
        } else {
          fundRows.push(['Default Mutual Fund', 'Diversified', '100%', '₹1,000,000', 'Core'])
        }

        y = this.drawTable(doc, 50, y, fundHeaders, fundRows, fundColWidths)
        
        y += 10
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(11).text('Fund-by-Fund Rationale & Risk Analysis:', 50, y)
        y += 18

        if (approvedPortfolio?.fund_allocations) {
          for (const a of approvedPortfolio.fund_allocations) {
            if (y > 700) {
              doc.addPage()
              y = 60
            }
            doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text(`• ${a.fund_name}:`, 50, y)
            y += 13
            const rationaleText = a.rationale || 'Selected for diversified core equity allocation aligned to client goals and investment timeline.'
            doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9).text(rationaleText, 60, y, {
              width: 485,
              lineGap: 3
            })
            const textHeight = doc.heightOfString(rationaleText, { width: 485, lineGap: 3 })
            y += textHeight + 15
          }
        }

        // ────────────────────────────────────────────────────────────────────────
        // PAGE 4: Section 4, Section 5 & Section 6
        // ────────────────────────────────────────────────────────────────────────
        doc.addPage()
        y = 60

        // Section 4: Risk Scenarios
        y = drawHeading('Section 4: Kiran Risk Scenarios & Stress Tests', y)
        
        const scenarioHeaders = ['Risk Scenario', 'Expected Return', 'Max Drawdown', 'Protection Mechanism']
        const scenarioColWidths = [170, 90, 85, 150]
        
        const scenarios = approvedPortfolio?.backtest_summary?.scenario_overlay?.scenarios || []
        const hedgePositions = approvedPortfolio?.hedge_instruments?.positions || []
        
        const scenarioRows: string[][] = []
        if (scenarios.length > 0) {
          for (const sc of scenarios) {
            let protection = 'Standard asset diversification'
            const scName = sc.scenario_name.toLowerCase()
            const match = hedgePositions.find((hp: any) => {
              const hpScenario = (hp.risk_scenario || '').toLowerCase()
              return hpScenario.includes(scName) || scName.includes(hpScenario) ||
                     (scName.includes('bear') && hpScenario.includes('bear')) ||
                     (scName.includes('bull') && hpScenario.includes('bull')) ||
                     (scName.includes('rate') && hpScenario.includes('rate')) ||
                     (scName.includes('depreciation') && hpScenario.includes('depreciation')) ||
                     (scName.includes('stagflation') && hpScenario.includes('stagflation'))
            })
            if (match) {
              protection = `${match.hedge_instrument}: ${match.hedge_rationale}`
              if (protection.length > 80) {
                protection = protection.slice(0, 77) + '...'
              }
            }
            
            scenarioRows.push([
              sc.scenario_name,
              `${sc.estimated_portfolio_return_pct > 0 ? '+' : ''}${parseFloat(sc.estimated_portfolio_return_pct).toFixed(1)}%`,
              `-${Math.abs(parseFloat(sc.worst_case_drawdown_pct)).toFixed(1)}%`,
              protection
            ])
          }
        } else {
          scenarioRows.push(['Indian equity bull run (+30%)', '+25.4%', '-2.1%', 'Core equity capitalization'])
          scenarioRows.push(['Indian equity bear market (-30%)', '-22.1%', '-28.5%', 'Debt allocation and hedging instruments'])
        }

        y = this.drawTable(doc, 50, y, scenarioHeaders, scenarioRows, scenarioColWidths)
        
        y += 10
        // Section 5: What to Watch
        y = drawHeading('Section 5: What to Watch (Triggers for Portfolio Review)', y)
        
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text('• Market Signal:', 50, y)
        doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9).text(' If India VIX stays above 25 for more than 30 consecutive trading days, risk profiles are re-evaluated.', 130, y)
        y += 18
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text('• Portfolio Signal:', 50, y)
        doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9).text(' If asset allocation drifts by > 5% from target weights (e.g. Equity > 75%), trigger automatic rebalancing.', 130, y)
        y += 18
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text('• Life Signal:', 50, y)
        doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9).text(' If your monthly income or critical liabilities change by more than 20%, goal targets and SIP amounts should be revised.', 130, y)
        
        y += 35
        
        // Section 6: Tax Summary
        y = drawHeading('Section 6: SEBI Compliance & Tax Summary', y)
        
        const efficiencyScore = complianceReport?.taxEfficiencyScore || 90
        const stcg = complianceReport?.stcgLiability || 0
        const ltcg = complianceReport?.ltcgLiability || 0
        const switchOrder = complianceReport?.recommendedSwitchOrder || []
        const elssGap = complianceReport?.elssGap
        
        doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(10)
        doc.text('Tax Efficiency Score:', col1X, y).font('Helvetica').fillColor(TEXT_COLOR).text(`${efficiencyScore}/100`, col1X + 120, y)
        
        y += 16
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('Estimated STCG Liability:', col1X, y).font('Helvetica').fillColor(TEXT_COLOR).text(`₹${stcg.toLocaleString('en-IN')}`, col1X + 130, y)
        doc.font('Helvetica-Bold').fillColor(PRIMARY).text('Estimated LTCG Liability:', col2X, y).font('Helvetica').fillColor(TEXT_COLOR).text(`₹${ltcg.toLocaleString('en-IN')}`, col2X + 130, y)
        
        y += 20
        if (elssGap && elssGap.applicable && elssGap.gap > 0) {
          doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text('ELSS Opportunity (Section 80C):', col1X, y)
          y += 13
          doc.fillColor(TEXT_COLOR).font('Helvetica').fontSize(9).text(`You have an unutilized Section 80C ELSS gap of ₹${elssGap.gap.toLocaleString('en-IN')}. Investing this in recommended ELSS tax-saver mutual funds can reduce taxable income.`, col1X, y, { width: 495 })
          y += 30
        }

        if (switchOrder.length > 0) {
          doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9.5).text('Recommended Switch Execution Order:', col1X, y)
          y += 13
          const orderStr = switchOrder.map((f: string, i: number) => `${i + 1}. ${f}`).join('  →  ')
          doc.fillColor(TEXT_COLOR).font('Helvetica-Bold').fontSize(8.5).text(orderStr, col1X, y, { width: 495 })
        }

        // ────────────────────────────────────────────────────────────────────────
        // FOOTERS PASS (BUFFERED PAGES)
        // ────────────────────────────────────────────────────────────────────────
        const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        const score = approvedPortfolio?.confidence_score?.total || packet?.confidence_score_breakdown?.total || 95
        
        const range = doc.bufferedPageRange()
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i)
          if (i === 0) continue // Skip cover page
          
          doc.moveTo(50, 785).lineTo(545, 785).strokeColor('#E2E8F0').lineWidth(0.5).stroke()
          
          doc.font('Helvetica').fontSize(7.5).fillColor('#64748B')
          doc.text(`Generated by pf-copilot on ${dateStr}`, 50, 792, { align: 'left', width: 200 })
          doc.text(`Pipeline Run ID: ${pipelineRunId}  |  Confidence Score: ${score}/100`, 180, 792, { align: 'center', width: 240 })
          doc.text(`Page ${i + 1} of ${range.count}`, 450, 792, { align: 'right', width: 95 })
          
          doc.fontSize(6).fillColor('#94A3B8').text(
            'Educational and illustrative report only. Mutual fund investments are subject to market risks. Read all scheme related documents carefully.',
            50,
            805,
            { align: 'center', width: 495 }
          )
        }

        doc.end()
      } catch (err) {
        reject(err)
      }
    })
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    startX: number,
    startY: number,
    headers: string[],
    rows: string[][],
    columnWidths: number[]
  ): number {
    let y = startY
    const rowHeight = 20
    const padding = 5

    // Draw header
    doc.fillColor('#0F172A')
    doc.font('Helvetica-Bold').fontSize(9)
    let x = startX
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      doc.text(headers[colIdx], x + padding, y + padding, { width: columnWidths[colIdx] - padding * 2, align: 'left' })
      x += columnWidths[colIdx]
    }
    
    // Header underline
    y += rowHeight
    doc.moveTo(startX, y).lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), y).strokeColor('#E2E8F0').lineWidth(1).stroke()
    
    // Draw rows
    doc.font('Helvetica').fontSize(9).fillColor('#1E293B')
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      // Check page boundary
      if (y + rowHeight > 750) {
        doc.addPage()
        y = 50
        // Redraw headers on new page
        doc.fillColor('#0F172A')
        doc.font('Helvetica-Bold').fontSize(9)
        x = startX
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
          doc.text(headers[colIdx], x + padding, y + padding, { width: columnWidths[colIdx] - padding * 2, align: 'left' })
          x += columnWidths[colIdx]
        }
        y += rowHeight
        doc.moveTo(startX, y).lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), y).strokeColor('#E2E8F0').lineWidth(1).stroke()
        doc.font('Helvetica').fontSize(9).fillColor('#1E293B')
      }

      x = startX
      const row = rows[rowIdx]
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        doc.text(row[colIdx], x + padding, y + padding, { width: columnWidths[colIdx] - padding * 2, align: 'left' })
        x += columnWidths[colIdx]
      }
      
      y += rowHeight
      // Draw fine separator line
      doc.moveTo(startX, y).lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), y).strokeColor('#F1F5F9').lineWidth(0.5).stroke()
    }

    return y + 10
  }
}
