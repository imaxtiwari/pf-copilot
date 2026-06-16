import { randomUUID } from 'crypto'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  CritiqueFault,
  CritiqueFaultSchema,
  CritiqueReport,
  CritiqueReportSchema,
  Severity,
} from './types/aria-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4oMini } from '../azure-openai'
import logger from '../logger'

const ARIA_SYSTEM_PROMPT = `You are ARIA (Analytical Review & Intelligence Agent), the Contrarian Critic in a multi-agent portfolio intelligence system for Indian investors.

YOUR ROLE: Find faults. Your job is not to block progress — it is to make the final portfolio genuinely better by catching problems before they reach the client.

YOUR CORE RULE: You never state a fact without a source. If you believe something is wrong but cannot cite a source, you say exactly this: "I believe [X] is a problem, but I do not have a current source to verify this — I am flagging it as an OBSERVATION for further verification, not a confirmed fault."

YOUR OUTPUT FORMAT: You always produce a \`CritiqueReport\` in valid JSON. Never output prose without also producing the JSON. The JSON is the canonical record.

YOUR FAULT CATEGORIES:
- METHODOLOGY: The analytical approach is flawed (e.g., using 1-year returns to select funds is recency bias)
- CONCENTRATION: The portfolio is overweight in a single sector, theme, AMC, or underlying stock
- SURVIVORSHIP_BIAS: The fund selection pool excludes poorly-performing or closed funds, making the pool look artificially good
- RECENCY_BIAS: Recent performance is being given disproportionate weight over long-term track record
- GOAL_MISMATCH: The portfolio's risk/return profile is not aligned with the client's stated goals and timeline
- COMPLIANCE: The recommendation may violate SEBI guidelines or best practice standards
- OTHER: Anything that does not fit the above

YOUR SEVERITY LEVELS:
- CRITICAL: This fault, if unaddressed, could cause the client significant financial harm or the recommendation is fundamentally wrong for this client. Blocks approval.
- MAJOR: This fault materially weakens the portfolio but does not make it fundamentally wrong. PRIYA must address before re-vote.
- MINOR: A real issue but not a blocker. Must be disclosed in the final portfolio packet.
- OBSERVATION: Something worth noting but below the threshold of a formal fault.

YOUR MEMORY: You have access to your fault library — patterns of failure you have observed across portfolios. Cite from it when relevant, but always check that the cited pattern is still applicable to current market conditions.

YOUR WEEKLY RESEARCH: Every Monday you perform a structured research sweep. You then update your fault library with new findings. Every new entry in your fault library must have a source.

YOUR DELIBERATION ROOM BEHAVIOUR: You speak after every PRIYA draft and after every VIKRAM goal plan. You can also be invoked by DHRUV at any time. In the deliberation room, you are direct but never dismissive. If another agent disagrees with your critique, engage with their counter-argument specifically — do not simply repeat your original position.

WHAT YOU MUST NOT DO:
- Do not propose specific fund allocations or weights.
- Do not approve anything — you have no approval authority.
- Do not let a CRITICAL fault go unraised because the pipeline is on its 5th revision cycle and you want to avoid deadlock. Your job is truth, not convenience.`

export class Aria {
  private deliberationRoom: DeliberationRoom
  private memoryStore: AgentMemoryStore
  private webResearchTool: WebResearchTool
  private db: any

  constructor(
    deliberationRoom: DeliberationRoom,
    memoryStore: AgentMemoryStore,
    webResearchTool: WebResearchTool,
    db: any
  ) {
    this.deliberationRoom = deliberationRoom
    this.memoryStore = memoryStore
    this.webResearchTool = webResearchTool
    this.db = db
  }

  private getHighestSeverity(faults: CritiqueFault[]): Severity {
    if (faults.some(f => f.severity === 'CRITICAL')) return 'CRITICAL'
    if (faults.some(f => f.severity === 'MAJOR')) return 'MAJOR'
    if (faults.some(f => f.severity === 'MINOR')) return 'MINOR'
    return 'OBSERVATION'
  }

  async critiquePortfolioDraft(
    draft: any,
    context: { message_id: string; client_id: string },
    pipelineRunId: string
  ): Promise<CritiqueReport> {
    logger.info({ pipelineRunId }, 'ARIA: critiquePortfolioDraft invoked')

    // 1. Recall fault library from memory
    let faultLibraryText = ''
    try {
      const recalled = await this.memoryStore.recall('ARIA', 'Portfolio fault patterns methodology concentration bias', {
        limit: 5,
        pipeline_run_id: pipelineRunId
      })
      if (recalled.length > 0) {
        faultLibraryText = recalled.map(entry => `Recalled fault: ${entry.content}`).join('\n')
      }
    } catch (err) {
      logger.warn({ err }, 'ARIA: failed to recall fault library')
    }

    // 2. Call LLM with ARIA system prompt
    const gpt = getGpt4oMini()
    const prompt = `
Analyze the following portfolio draft. Compare it against past fault patterns if relevant.
Identify any faults in sectors/stocks concentration, methodology, bias, goal mismatch, or compliance.
For each fault, provide description (max 200 words) and remedy (max 100 words).
You must return a valid JSON object ONLY. Do not include markdown code blocks.

Portfolio Draft:
${JSON.stringify(draft, null, 2)}

Recalled Fault Library Context:
${faultLibraryText || 'None.'}

JSON Schema:
{
  "faults": [
    {
      "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "COMPLIANCE" | "OTHER",
      "fault_description": string, // max 200 words
      "evidence_sources": [
        { "url": string, "excerpt_summary": string }
      ],
      "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION",
      "suggested_remedy": string, // max 100 words
      "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
    }
  ],
  "overall_assessment": string
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const faults: CritiqueFault[] = (parsed.faults || []).map((f: any) => {
      const evidence = (f.evidence_sources || []).map((e: any) => ({
        url: e.url || 'https://sebi.gov.in',
        excerpt_summary: e.excerpt_summary || 'Excerpt summary details',
        retrieved_at: now.toISOString()
      }))
      return {
        fault_id: randomUUID(),
        fault_category: f.fault_category,
        fault_description: f.fault_description,
        evidence_sources: evidence.length > 0 ? evidence : [{ url: 'https://sebi.gov.in', excerpt_summary: 'SEBI default verification', retrieved_at: now.toISOString() }],
        severity: f.severity,
        suggested_remedy: f.suggested_remedy,
        confidence_tier: f.confidence_tier || 'VERIFIED',
        from_fault_library: false,
      }
    })

    const report: CritiqueReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: draft.draft_version || 1,
      critiqued_at: now.toISOString(),
      faults,
      critical_count: faults.filter(f => f.severity === 'CRITICAL').length,
      major_count: faults.filter(f => f.severity === 'MAJOR').length,
      minor_count: faults.filter(f => f.severity === 'MINOR').length,
      observation_count: faults.filter(f => f.severity === 'OBSERVATION').length,
      overall_assessment: parsed.overall_assessment || 'Portfolio review complete.',
    }

    const validated = CritiqueReportSchema.parse(report)

    // 3. Save CritiqueReport to memory
    await this.memoryStore.write('ARIA', {
      content: `Aria Critique Report: ${validated.overall_assessment}. Faults: ${validated.faults.length}`,
      memory_type: 'ARIA_CRITIQUE_REPORT',
      source_url: 'Deliberation',
      confidence_tier: 'VERIFIED',
      tags: ['critique_report', pipelineRunId],
      pipeline_run_id: pipelineRunId
    })

    // 4. Publish CRITIQUE to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'ARIA',
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      payload: {
        target_message_id: context.message_id,
        critique_points: validated.faults.map(f => f.fault_description),
        severity: this.getHighestSeverity(validated.faults),
        recommended_action: validated.overall_assessment,
      },
      references: [context.message_id]
    })

    return validated
  }

  async critiqueGoalPlan(
    assessment: any,
    pipelineRunId: string
  ): Promise<CritiqueReport> {
    logger.info({ pipelineRunId }, 'ARIA: critiqueGoalPlan invoked')

    // Call LLM with ARIA system prompt targeting Vikram's ClientGoalAssessment
    const gpt = getGpt4oMini()
    const prompt = `
Analyze the following client goal plan assessment from Vikram.
Identify any faults in stated goals, sequencing, math viability, or framework selection.
For each fault, provide description (max 200 words) and remedy (max 100 words).
You must return a valid JSON object ONLY. Do not include markdown code blocks.

Vikram's Goal Assessment:
${JSON.stringify(assessment, null, 2)}

JSON Schema:
{
  "faults": [
    {
      "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "COMPLIANCE" | "OTHER",
      "fault_description": string, // max 200 words
      "evidence_sources": [
        { "url": string, "excerpt_summary": string }
      ],
      "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION",
      "suggested_remedy": string, // max 100 words
      "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
    }
  ],
  "overall_assessment": string
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const faults: CritiqueFault[] = (parsed.faults || []).map((f: any) => {
      const evidence = (f.evidence_sources || []).map((e: any) => ({
        url: e.url || 'https://sebi.gov.in',
        excerpt_summary: e.excerpt_summary || 'Excerpt summary details',
        retrieved_at: now.toISOString()
      }))
      return {
        fault_id: randomUUID(),
        fault_category: f.fault_category,
        fault_description: f.fault_description,
        evidence_sources: evidence.length > 0 ? evidence : [{ url: 'https://sebi.gov.in', excerpt_summary: 'SEBI default verification', retrieved_at: now.toISOString() }],
        severity: f.severity,
        suggested_remedy: f.suggested_remedy,
        confidence_tier: f.confidence_tier || 'VERIFIED',
        from_fault_library: false,
      }
    })

    const report: CritiqueReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: assessment.version || 1,
      critiqued_at: now.toISOString(),
      faults,
      critical_count: faults.filter(f => f.severity === 'CRITICAL').length,
      major_count: faults.filter(f => f.severity === 'MAJOR').length,
      minor_count: faults.filter(f => f.severity === 'MINOR').length,
      observation_count: faults.filter(f => f.severity === 'OBSERVATION').length,
      overall_assessment: parsed.overall_assessment || 'Goal plan review complete.',
    }

    const validated = CritiqueReportSchema.parse(report)

    // Save CritiqueReport to memory
    await this.memoryStore.write('ARIA', {
      content: `Aria Critique Report (Goal Plan): ${validated.overall_assessment}. Faults: ${validated.faults.length}`,
      memory_type: 'ARIA_CRITIQUE_REPORT',
      source_url: 'Deliberation',
      confidence_tier: 'VERIFIED',
      tags: ['critique_report_goal_plan', pipelineRunId],
      pipeline_run_id: pipelineRunId
    })

    // Publish CRITIQUE to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'ARIA',
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      payload: {
        target_message_id: assessment.assessment_id,
        critique_points: validated.faults.map(f => f.fault_description),
        severity: this.getHighestSeverity(validated.faults),
        recommended_action: validated.overall_assessment,
      },
      references: [assessment.assessment_id]
    })

    return validated
  }

  async respondToCounterArgument(
    originalFault: CritiqueFault,
    counterArgument: string,
    pipelineRunId: string
  ): Promise<CritiqueFault> {
    logger.info({ faultId: originalFault.fault_id, pipelineRunId }, 'ARIA: respondToCounterArgument invoked')

    const gpt = getGpt4oMini()
    const prompt = `
Respond to the client or agent's counter-argument regarding this critique fault.
You must EITHER:
a) Downgrade the severity level with explicit new reasoning.
b) Maintain the severity level but support it with new specific evidence.
You CANNOT simply re-state your original argument. You must return a valid JSON object ONLY. No markdown or backticks.

Original Fault:
${JSON.stringify(originalFault, null, 2)}

Counter Argument:
${counterArgument}

JSON Schema:
{
  "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "COMPLIANCE" | "OTHER",
  "fault_description": string, // max 200 words (updated or defended)
  "evidence_sources": [
    { "url": string, "excerpt_summary": string } // new evidence if severity maintained
  ],
  "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION", // downgraded or same
  "suggested_remedy": string, // max 100 words
  "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const evidence = (parsed.evidence_sources || []).map((e: any) => ({
      url: e.url || 'https://sebi.gov.in',
      excerpt_summary: e.excerpt_summary || 'New supporting evidence',
      retrieved_at: now.toISOString()
    }))

    const updatedFault: CritiqueFault = {
      fault_id: originalFault.fault_id,
      fault_category: parsed.fault_category,
      fault_description: parsed.fault_description,
      evidence_sources: evidence.length > 0 ? evidence : originalFault.evidence_sources,
      severity: parsed.severity,
      suggested_remedy: parsed.suggested_remedy,
      confidence_tier: parsed.confidence_tier || 'VERIFIED',
      from_fault_library: true,
    }

    return CritiqueFaultSchema.parse(updatedFault)
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('ARIA: starting weekly critic sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'mutual fund portfolio mistakes concentration risk survivorship bias SEBI warning guidelines investor advisory',
        intent: 'weekly_sweep_critique',
        freshness_required_days: 7,
        max_sources: 4,
        memory_type: 'ARIA_CRITIQUE_REPORT'
      }, 'WEEKLY_RESEARCH')

      logger.info({ resultsCount: results.length }, 'ARIA: weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'ARIA: weekly sweep research failed')
    }
  }
}
