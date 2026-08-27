import { randomUUID } from 'crypto'
import {
  CritiqueFault,
  CritiqueFaultSchema,
  CritiqueReport,
  CritiqueReportSchema,
  Severity,
  PreflightContext,
  PreflightReport,
  PreflightReportSchema,
} from '@/lib/agents/types'
import { ClientGoalAssessment } from '@/lib/agents/types'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { writeMemory, makePipelineKey } from '@/lib/memory/memory-store'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import { getGpt4o } from '@/lib/azure-openai'
import logger from '@/lib/logger'
import { ARIA_SYSTEM_PROMPT_V1, ARIA_PREFLIGHT_PROMPT_V1 } from '@/lib/agents/prompts'

function cleanAndParseJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

/**
 * ARIA VOTE DECISION MATRIX
 * ─────────────────────────────────────────────────────────
 * Fault profile              Vote    Deciding factor
 * ─────────────────────────────────────────────────────────
 * Any CRITICAL               REJECT  CRITICAL_FAULT
 * Any MAJOR                  REJECT  MAJOR_FAULT
 * MINOR count > 3            REJECT  MINOR_ACCUMULATION
 * MINOR count ≤ 3            APPROVE MINOR_ACCEPTABLE
 * OBSERVATION only / empty   APPROVE CLEAN
 * ─────────────────────────────────────────────────────────
 * This matrix is the source of truth. deriveARIAVote() implements it.
 * ARIA has no approval authority; the vote is an input to the committee.
 */
export function deriveARIAVote(faults: CritiqueFault[]): {
  vote: 'APPROVE' | 'REJECT'
  reasoning: string
  faultSummary: { CRITICAL: number; MAJOR: number; MINOR: number; OBSERVATION: number }
  decidingFactor: 'CRITICAL_FAULT' | 'MAJOR_FAULT' | 'MINOR_ACCUMULATION' | 'CLEAN' | 'MINOR_ACCEPTABLE'
} {
  const summary = {
    CRITICAL: faults.filter((f) => f.severity === 'CRITICAL').length,
    MAJOR: faults.filter((f) => f.severity === 'MAJOR').length,
    MINOR: faults.filter((f) => f.severity === 'MINOR').length,
    OBSERVATION: faults.filter((f) => f.severity === 'OBSERVATION').length,
  }

  if (summary.CRITICAL > 0) {
    return {
      vote: 'REJECT',
      reasoning: `${summary.CRITICAL} CRITICAL point(s) for discussion found.`,
      faultSummary: summary,
      decidingFactor: 'CRITICAL_FAULT',
    }
  }

  if (summary.MAJOR > 0) {
    return {
      vote: 'REJECT',
      reasoning: `${summary.MAJOR} MAJOR point(s) for discussion found.`,
      faultSummary: summary,
      decidingFactor: 'MAJOR_FAULT',
    }
  }

  if (summary.MINOR > 3) {
    return {
      vote: 'REJECT',
      reasoning: `${summary.MINOR} MINOR points found (exceeds threshold of 3).`,
      faultSummary: summary,
      decidingFactor: 'MINOR_ACCUMULATION',
    }
  }

  if (summary.MINOR > 0) {
    return {
      vote: 'APPROVE',
      reasoning: `${summary.MINOR} MINOR point(s) found (acceptable for discussion).`,
      faultSummary: summary,
      decidingFactor: 'MINOR_ACCEPTABLE',
    }
  }

  return {
    vote: 'APPROVE',
    reasoning: 'No significant points for discussion found.',
    faultSummary: summary,
    decidingFactor: 'CLEAN',
  }
}

/**
 * ARIA — Analytical Review & Intelligence Agent.
 *
 * ARIA is the contrarian critic. It frames every critique as a "point for
 * discussion" and has no approval authority. It cannot override Oracle.
 */
export class Aria {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
  }

  private getHighestSeverity(faults: CritiqueFault[]): Severity {
    if (faults.some((f) => f.severity === 'CRITICAL')) return 'CRITICAL'
    if (faults.some((f) => f.severity === 'MAJOR')) return 'MAJOR'
    if (faults.some((f) => f.severity === 'MINOR')) return 'MINOR'
    return 'OBSERVATION'
  }

  async runPreflight(context: PreflightContext): Promise<PreflightReport> {
    logger.info({ pipelineRunId: context.pipelineRunId }, 'ARIA: runPreflight invoked')

    const gpt = getGpt4o()
    const prompt = `
Client Goal Profile:
${JSON.stringify(context.goalProfile, null, 2)}

Client Risk Profile:
${JSON.stringify(context.clientRiskProfile, null, 2)}

Fund Universe (Available Funds):
${JSON.stringify(context.fundUniverse, null, 2)}
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: ARIA_PREFLIGHT_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })

    const rawContent = response.choices[0]?.message?.content?.trim() || '{}'
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawContent)
    } catch (e) {
      logger.error({ rawContent, err: e }, 'ARIA: Failed to parse preflight JSON')
      throw new Error('ARIA: Preflight report is not valid JSON')
    }

    const preflightReport: PreflightReport = {
      predictedFailureModes: (parsed.predictedFailureModes || []).map((f: any) => ({
        faultCategory: f.faultCategory || 'OTHER',
        severity: f.severity || 'MINOR',
        description: f.description || '',
        avoidanceGuidance: f.avoidanceGuidance || '',
      })),
      generatedAt: new Date(),
      pipelineRunId: context.pipelineRunId,
    }

    const validated = PreflightReportSchema.parse(preflightReport)

    await writeMemory(
      'ARIA',
      makePipelineKey('ARIA', 'preflight_report', context.userId, context.pipelineRunId),
      {
        content: validated,
        memory_type: 'ARIA_CRITIQUE_REPORT',
        source_url: 'Internal',
        confidence_tier: 'INFERRED',
        tags: [makePipelineKey('ARIA', 'preflight_report', context.userId, context.pipelineRunId)],
        pipeline_run_id: context.pipelineRunId,
      },
      context.userId,
    )

    await this.deliberationRoom.bind(context.pipelineRunId).publish({
      sender: 'ARIA',
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      content: `ARIA: Preflight discussion points ready (${validated.predictedFailureModes.length} items).`,
      payload: {
        failureModeCount: validated.predictedFailureModes.length,
        categories: validated.predictedFailureModes.map((f) => f.faultCategory),
      },
      references: [],
    })

    auditTrail.log({
      pipeline_run_id: context.pipelineRunId,
      user_id: context.userId,
      agent_id: 'ARIA',
      action_type: AuditActionType.ARIA_PREFLIGHT_COMPLETE,
      payload: {
        failureModeCount: validated.predictedFailureModes.length,
        categories: validated.predictedFailureModes.map((f) => f.faultCategory),
      },
    })

    return validated
  }

  async critiquePortfolioDraft(
    draft: any,
    context: { message_id: string; client_id: string },
    pipelineRunId: string,
    complianceReport?: any,
  ): Promise<CritiqueReport> {
    logger.info({ pipelineRunId }, 'ARIA: critiquePortfolioDraft invoked')

    const gpt = getGpt4o()
    const prompt = `
Analyze the following portfolio draft. Identify any points for discussion in sectors/stocks concentration, methodology, bias, or goal mismatch.
For each point, provide a description (max 200 words) and a suggested remedy (max 100 words).
You must return a valid JSON object ONLY. Do not include markdown code blocks.

Portfolio Draft:
${JSON.stringify(draft, null, 2)}

SEBI Compliance Report:
${complianceReport ? JSON.stringify(complianceReport, null, 2) : 'None.'}

JSON Schema:
{
  "faults": [
    {
      "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "OTHER",
      "fault_description": string,
      "evidence_sources": [
        { "url": string, "excerpt_summary": string }
      ],
      "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION",
      "suggested_remedy": string,
      "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
    }
  ],
  "overall_assessment": string
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'ARIA: Failed to parse portfolio critique JSON')
      throw new Error('ARIA: Portfolio critique is not valid JSON')
    }

    const now = new Date()
    const faults: CritiqueFault[] = this.normalizeFaults(parsed.faults || [], now)

    const report: CritiqueReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: draft.draft_version || 1,
      critiqued_at: now.toISOString(),
      faults,
      critical_count: faults.filter((f) => f.severity === 'CRITICAL').length,
      major_count: faults.filter((f) => f.severity === 'MAJOR').length,
      minor_count: faults.filter((f) => f.severity === 'MINOR').length,
      observation_count: faults.filter((f) => f.severity === 'OBSERVATION').length,
      overall_assessment: this.educationalAssessment(parsed.overall_assessment),
    }

    const validated = CritiqueReportSchema.parse(report)

    await writeMemory(
      'ARIA',
      makePipelineKey('ARIA', 'critique_report', context.client_id, pipelineRunId),
      {
        content: `Aria Critique Report: ${validated.overall_assessment}. Points for discussion: ${validated.faults.length}`,
        memory_type: 'ARIA_CRITIQUE_REPORT',
        source_url: 'Deliberation',
        confidence_tier: 'VERIFIED',
        tags: [
          makePipelineKey('ARIA', 'critique_report', context.client_id, pipelineRunId),
          makePipelineKey('ARIA', 'fault_list', context.client_id, pipelineRunId),
        ],
        pipeline_run_id: pipelineRunId,
      },
      context.client_id,
    )

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'ARIA',
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      content: `ARIA: ${validated.faults.length} point(s) for discussion on the latest portfolio draft.`,
      payload: {
        target_message_id: context.message_id,
        critique_points: validated.faults.map((f) => f.fault_description),
        severity: this.getHighestSeverity(validated.faults),
        recommended_action: validated.overall_assessment,
      },
      references: [context.message_id],
    })

    return validated
  }

  async critiqueGoalPlan(assessment: ClientGoalAssessment, pipelineRunId: string): Promise<CritiqueReport> {
    logger.info({ pipelineRunId }, 'ARIA: critiqueGoalPlan invoked')

    const gpt = getGpt4o()
    const prompt = `
Review the following client goal plan assessment. Identify points for discussion regarding goal realism, methodology, or potential behavioral mismatch.
For each point, provide a description (max 200 words) and a suggested remedy (max 100 words).
You must return a valid JSON object ONLY. Do not include markdown code blocks.

Client Goal Assessment:
${JSON.stringify(assessment, null, 2)}

JSON Schema:
{
  "faults": [
    {
      "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "OTHER",
      "fault_description": string,
      "evidence_sources": [
        { "url": string, "excerpt_summary": string }
      ],
      "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION",
      "suggested_remedy": string,
      "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
    }
  ],
  "overall_assessment": string
}
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'ARIA: Failed to parse goal critique JSON')
      throw new Error('ARIA: Goal plan critique is not valid JSON')
    }

    const now = new Date()
    const faults: CritiqueFault[] = this.normalizeFaults(parsed.faults || [], now)

    const report: CritiqueReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: 1,
      critiqued_at: now.toISOString(),
      faults,
      critical_count: faults.filter((f) => f.severity === 'CRITICAL').length,
      major_count: faults.filter((f) => f.severity === 'MAJOR').length,
      minor_count: faults.filter((f) => f.severity === 'MINOR').length,
      observation_count: faults.filter((f) => f.severity === 'OBSERVATION').length,
      overall_assessment: this.educationalAssessment(parsed.overall_assessment),
    }

    const validated = CritiqueReportSchema.parse(report)

    await writeMemory(
      'ARIA',
      makePipelineKey('ARIA', 'goal_critique_report', assessment.client_id, pipelineRunId),
      {
        content: `Aria Goal Plan Critique: ${validated.overall_assessment}. Points for discussion: ${validated.faults.length}`,
        memory_type: 'ARIA_CRITIQUE_REPORT',
        source_url: 'Deliberation',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('ARIA', 'goal_critique_report', assessment.client_id, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      assessment.client_id,
    )

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'ARIA',
      message_type: 'CRITIQUE',
      recipient: 'ALL',
      content: `ARIA: ${validated.faults.length} point(s) for discussion on the goal plan.`,
      payload: {
        target_message_id: assessment.assessment_id,
        critique_points: validated.faults.map((f) => f.fault_description),
        severity: this.getHighestSeverity(validated.faults),
        recommended_action: validated.overall_assessment,
      },
      references: [assessment.assessment_id],
    })

    return validated
  }

  async respondToCounterArgument(
    originalFault: CritiqueFault,
    counterArgument: string,
    pipelineRunId: string,
  ): Promise<CritiqueFault> {
    logger.info({ faultId: originalFault.fault_id, pipelineRunId }, 'ARIA: respondToCounterArgument invoked')

    const gpt = getGpt4o()
    const prompt = `
Respond to the client or agent's counter-argument regarding this critique point.
You must EITHER:
a) Downgrade the severity level with explicit new reasoning.
b) Maintain the severity level but support it with new specific evidence.
You CANNOT simply re-state your original argument. You must return a valid JSON object ONLY. No markdown or backticks.

Original Point:
${JSON.stringify(originalFault, null, 2)}

Counter Argument:
${counterArgument}

JSON Schema:
{
  "fault_category": "METHODOLOGY" | "CONCENTRATION" | "SURVIVORSHIP_BIAS" | "RECENCY_BIAS" | "GOAL_MISMATCH" | "OTHER",
  "fault_description": string,
  "evidence_sources": [
    { "url": string, "excerpt_summary": string }
  ],
  "severity": "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION",
  "suggested_remedy": string,
  "confidence_tier": "VERIFIED" | "INFERRED" | "ASSUMED"
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: ARIA_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'ARIA: Failed to parse counter-argument JSON')
      throw new Error('ARIA: Counter-argument response is not valid JSON')
    }

    const now = new Date()
    const evidence = (parsed.evidence_sources || []).map((e: any) => ({
      url: e.url || 'https://sebi.gov.in',
      excerpt_summary: e.excerpt_summary || 'New supporting evidence',
      retrieved_at: now.toISOString(),
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

  private normalizeFaults(rawFaults: any[], now: Date): CritiqueFault[] {
    return rawFaults.map((f: any) => {
      const evidence = (f.evidence_sources || []).map((e: any) => ({
        url: e.url || 'https://sebi.gov.in',
        excerpt_summary: e.excerpt_summary || 'Excerpt summary details',
        retrieved_at: now.toISOString(),
      }))

      const allowedCategories = ['METHODOLOGY', 'CONCENTRATION', 'SURVIVORSHIP_BIAS', 'RECENCY_BIAS', 'GOAL_MISMATCH', 'OTHER']
      let category = (f.fault_category || '').toUpperCase().trim().replace(/\s+/g, '_')
      if (!allowedCategories.includes(category)) {
        category = 'OTHER'
      }

      const allowedSeverities = ['CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION']
      let severity = (f.severity || '').toUpperCase().trim()
      if (!allowedSeverities.includes(severity)) {
        severity = 'OBSERVATION'
      }

      const allowedTiers = ['VERIFIED', 'INFERRED', 'ASSUMED']
      let tier = (f.confidence_tier || '').toUpperCase().trim()
      if (!allowedTiers.includes(tier)) {
        tier = 'VERIFIED'
      }

      return {
        fault_id: randomUUID(),
        fault_category: category as any,
        fault_description: f.fault_description || 'Point for discussion.',
        evidence_sources:
          evidence.length > 0
            ? evidence
            : [{ url: 'https://sebi.gov.in', excerpt_summary: 'SEBI default reference', retrieved_at: now.toISOString() }],
        severity: severity as any,
        suggested_remedy: f.suggested_remedy,
        confidence_tier: tier as any,
        from_fault_library: false,
      }
    })
  }

  private educationalAssessment(text?: string): string {
    const base = text || 'Goal plan review complete.'
    if (/point for discussion/i.test(base)) return base
    return `${base} (points for discussion)`.replace(/\s+/g, ' ').trim()
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('ARIA: starting weekly critic sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text:
            'mutual fund portfolio mistakes concentration risk survivorship bias SEBI warning guidelines investor advisory',
          intent: 'weekly_sweep_critique',
          freshness_required_days: 7,
          max_sources: 4,
          memory_type: 'ARIA_CRITIQUE_REPORT',
        },
        'WEEKLY_RESEARCH',
      )
      logger.info('ARIA: weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'ARIA: weekly sweep research failed')
    }
  }
}
