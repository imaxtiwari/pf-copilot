import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { getGpt4oMini } from '@/lib/azure-openai'
import { writeMemory, makePipelineKey } from '@/lib/memory/memory-store'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import logger from '@/lib/logger'
import { RIYA_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'

export interface BehavioralPattern {
  patternType:
    | 'RECENCY_CHASING'
    | 'WINNER_CONCENTRATION'
    | 'OVER_DIVERSIFICATION'
    | 'LOSS_AVERSION'
    | 'ANCHORING_BIAS'
    | 'OVER_CONFIDENCE'
    | 'INERTIA'
    | 'PANIC_SIGNALS'
    | 'PLAN_DEVIATION'
    | 'SIP_DISCIPLINE'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  evidence: string
  implication: string
}

export interface BehavioralFingerprint {
  patterns: BehavioralPattern[]
  riskToleranceReality: 'LOWER_THAN_STATED' | 'MATCHES_STATED' | 'HIGHER_THAN_STATED'
  riskToleranceReasoning: string
  portfolioAbandonmentRisk: 'HIGH' | 'MEDIUM' | 'LOW'
  abandonmentRiskReasoning: string
  constructionGuidance: string[]
}

export interface RiyaInputs {
  userId: string
  pipelineRunId: string
  goalHypothesisCorrections: string[]
  driftReport?: any
  chatHistory?: { role: string; content: string }[]
  existingHoldings?: { scheme_code: string; fund_name?: string; value?: number; units?: number }[]
}

/**
 * RIYA — Reflective Investor Yield Analyst.
 *
 * RIYA builds a BehavioralFingerprint for educational discussion. It reads
 * user profile and holdings context, persists only the inferred fingerprint
 * (not raw chat), and produces actionable guidance for PRIYA.
 */
export class Riya {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
  }

  async getDatabaseFingerprint(userId: string, pipelineRunId: string): Promise<BehavioralFingerprint | null> {
    try {
      const [existing] = await this.db
        .select()
        .from(schema.behavioralFingerprints)
        .where(eq(schema.behavioralFingerprints.pipelineRunId, pipelineRunId))
        .limit(1)
      if (existing) {
        return existing.fingerprint as BehavioralFingerprint
      }
    } catch (err) {
      logger.warn({ err, userId }, 'RIYA: Failed to check database fingerprint')
    }
    return null
  }

  async saveToDatabase(userId: string, pipelineRunId: string, fingerprint: BehavioralFingerprint): Promise<void> {
    try {
      await this.db
        .insert(schema.behavioralFingerprints)
        .values({
          userId,
          pipelineRunId,
          fingerprint,
        })
        .onConflictDoUpdate({
          target: schema.behavioralFingerprints.pipelineRunId,
          set: {
            fingerprint,
          },
        })
    } catch (err) {
      logger.error({ err, userId, pipelineRunId }, 'RIYA: Failed to save fingerprint to DB')
    }
  }

  private async loadUserProfile(userId: string): Promise<Record<string, unknown> | null> {
    try {
      const [profile] = await this.db
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.userId, userId))
        .limit(1)
      return profile || null
    } catch (err) {
      logger.warn({ err, userId }, 'RIYA: Failed to load user profile')
      return null
    }
  }

  async getOrGenerateFingerprint(inputs: RiyaInputs): Promise<BehavioralFingerprint> {
    const { userId, pipelineRunId, goalHypothesisCorrections, driftReport, chatHistory, existingHoldings } = inputs

    const dbFp = await this.getDatabaseFingerprint(userId, pipelineRunId)
    if (dbFp) {
      logger.info({ userId, pipelineRunId }, 'RIYA: returning cached fingerprint from DB')
      return dbFp
    }

    logger.info({ pipelineRunId }, 'RIYA: getOrGenerateFingerprint invoked')

    const userProfile = await this.loadUserProfile(userId)
    const holdings = existingHoldings || []
    const chat = chatHistory || []

    const totalCurrentValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0)
    const userProfileText = `User holds ${holdings.length} funds with total value ₹${totalCurrentValue.toLocaleString('en-IN')}.`

    const factsContext = `
1. WINNER_CONCENTRATION: ${holdings.length > 0 ? 'TRUE (Holdings present; verify concentration in recent winners)' : 'FALSE (No holdings data)'}
2. OVER_DIVERSIFICATION: ${holdings.length > 8 ? `TRUE (${holdings.length} funds held)` : 'FALSE'}
3. PANIC_SIGNALS: ${chat.some((m) => /\b(worry|fear|panic|nervous|scared)\b/i.test(m.content)) ? 'TRUE (Chat contains worry/fear language)' : 'FALSE'}
`

    let driftContext = 'No portfolio drift data available.\n'
    if (driftReport) {
      driftContext = `
Drift Analysis (Since last upload ${driftReport.daysBetweenUploads || 0} days ago):
- Changes: New: ${driftReport.changes?.newPositions?.length || 0}, Exits: ${driftReport.changes?.exitedPositions?.length || 0}
- Detected SIPs: ${driftReport.sipDetection?.map((s: any) => `${s.schemeName} (Est. ₹${s.estimatedMonthlyAmount}/mo)`).join(', ') || 'None'}
`
    }

    const prompt = `You are running a behavioral profiling for client ${userId} based on holdings, drift history, chat history, and goal corrections.

Demographics/Context:
${userProfileText}

User Profile (non-sensitive):
${JSON.stringify(userProfile, null, 2)}

Heuristics Context:
${factsContext}

Drift Context:
${driftContext}

Goal Corrections (Vikram Goal Hypothesis corrections):
${goalHypothesisCorrections.length > 0 ? goalHypothesisCorrections.map((c) => `- ${c}`).join('\n') : 'None.'}

Chat History snippet (do not persist raw text; use only for pattern inference):
${chat
  .map((m: any) => `[${m.role}]: ${m.content}`)
  .slice(-20)
  .join('\n')}

Generate the BehavioralFingerprint following the schema. Return valid JSON only.`

    const gpt = getGpt4oMini()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RIYA_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || '{}'
    let fingerprint: BehavioralFingerprint
    try {
      fingerprint = JSON.parse(rawText) as BehavioralFingerprint
    } catch (e) {
      logger.error({ rawText, err: e }, 'RIYA: Failed to parse fingerprint JSON')
      throw new Error('RIYA: Behavioral fingerprint is not valid JSON')
    }

    await this.saveToDatabase(userId, pipelineRunId, fingerprint)

    await writeMemory(
      'RIYA',
      makePipelineKey('RIYA', 'behavioral_fingerprint', userId, pipelineRunId),
      {
        content: fingerprint,
        memory_type: 'RIYA_BEHAVIORAL_FINGERPRINT',
        source_url: 'Internal',
        confidence_tier: 'INFERRED',
        tags: [makePipelineKey('RIYA', 'behavioral_fingerprint', userId, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      userId,
    )

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'RIYA',
      message_type: 'BEHAVIORAL_PROFILE',
      recipient: 'ALL',
      content: `RIYA: Behavioral fingerprint ready for discussion. Abandonment risk: ${fingerprint.portfolioAbandonmentRisk}. Patterns detected: ${fingerprint.patterns?.length || 0}.`,
      payload: {
        patterns_detected: fingerprint.patterns?.length || 0,
        abandonment_risk: fingerprint.portfolioAbandonmentRisk,
        risk_tolerance_reality: fingerprint.riskToleranceReality,
        construction_guidance: fingerprint.constructionGuidance,
      },
      references: [],
    })

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: userId,
      agent_id: 'RIYA',
      action_type: AuditActionType.RIYA_PROFILING_COMPLETE,
      payload: {
        patterns_detected: fingerprint.patterns?.length || 0,
        abandonment_risk: fingerprint.portfolioAbandonmentRisk,
        cache_hit: false,
      },
    })

    return fingerprint
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('RIYA: starting weekly behavioral research sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text:
            'behavioral finance investor biases India mutual funds recency bias loss aversion SEBI investor awareness',
          intent: 'weekly_sweep_behavioral',
          freshness_required_days: 7,
          max_sources: 4,
          memory_type: 'RIYA_BEHAVIORAL_FINGERPRINT',
        },
        'WEEKLY_RESEARCH',
      )
      logger.info('RIYA: weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'RIYA: weekly sweep research failed')
    }
  }
}
