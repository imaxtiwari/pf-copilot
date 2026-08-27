import { randomUUID } from 'crypto'
import {
  ClientGoalAssessment,
  ClientGoalAssessmentSchema,
  StrategyFramework,
  StrategyFrameworkSchema,
  EssentialAnswers,
  GoalHypothesis,
  GoalHypothesisSchema,
  UserCorrection,
  EssentialQuestion,
  DecomposedGoal,
  ClientRiskProfile,
} from '@/lib/agents/types'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { writeMemory, makePipelineKey } from '@/lib/memory/memory-store'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { getGpt4o, getGpt4oMini } from '@/lib/azure-openai'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'
import { VIKRAM_SYSTEM_PROMPT_V1, VIKRAM_HYPOTHESIS_PROMPT_V1 } from '@/lib/agents/prompts'

function cleanAndParseJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

/**
 * VIKRAM — Visionary Intelligence for Kinetic Return & Asset Management.
 *
 * VIKRAM performs structured goal assessment for educational discussion. It
 * generates explicit, correctable hypotheses and selects strategy frameworks,
 * but never recommends specific funds without SOMA's data.
 */
export class Vikram {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
  }

  async askEssentialQuestions(): Promise<EssentialQuestion[]> {
    return [
      { id: 'age', text: 'What is your age?', type: 'number' },
      { id: 'monthly_take_home_lakh', text: 'What is your monthly take-home income (in lakhs)?', type: 'number' },
      { id: 'biggest_goal', text: 'What is your biggest financial goal? (Describe in one sentence)', type: 'text' },
      { id: 'goal_timeline_years', text: 'What is your target timeline for that goal (in years)?', type: 'number' },
      {
        id: 'risk_reaction',
        text: 'How would you feel if your portfolio dropped 20% in a year?',
        type: 'choice',
        options: ['A - Panic and sell', 'B - Worried but hold', 'C - Buy more'],
      },
    ]
  }

  async generateHypothesis(
    answers: EssentialAnswers,
    clientData: any,
    pipelineRunId: string,
    behavioralFingerprint?: any,
  ): Promise<GoalHypothesis> {
    logger.info({ pipelineRunId }, 'VIKRAM: generateHypothesis invoked')

    const gpt = getGpt4o()
    let prompt = `
Stated demographic info from client profile:
${JSON.stringify(clientData, null, 2)}

Answers to 5 essential questions:
- Age: ${answers.age}
- Monthly take-home (Lakhs): ${answers.monthly_take_home_lakh}
- Biggest Goal: "${answers.biggest_goal}"
- Goal Timeline (Years): ${answers.goal_timeline_years}
- Risk Reaction Option: ${answers.risk_reaction}
`

    if (behavioralFingerprint) {
      const guidance = Array.isArray(behavioralFingerprint.constructionGuidance)
        ? behavioralFingerprint.constructionGuidance.join(', ')
        : ''
      prompt += `
RIYA's behavioral assessment: ${guidance}.
Adjust your strategy framework recommendation accordingly.
`
      if (behavioralFingerprint.riskToleranceReality === 'LOWER_THAN_STATED') {
        prompt += `
IMPORTANT: RIYA has assessed that the client's actual risk tolerance is LOWER THAN STATED. You must adjust your strategy framework selection and recommended risk profile towards a more conservative allocation.
`
      }
    }

    prompt += `
Generate a GoalHypothesis JSON object following the prompt instructions.
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: VIKRAM_HYPOTHESIS_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let hypothesisData: any
    try {
      hypothesisData = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'VIKRAM: Failed to parse hypothesis JSON')
      throw new Error('VIKRAM: Goal hypothesis is not valid JSON')
    }

    if (!hypothesisData.hypothesis_id) {
      hypothesisData.hypothesis_id = randomUUID()
    }
    if (!hypothesisData.generated_at) {
      hypothesisData.generated_at = new Date().toISOString()
    }

    const validated = GoalHypothesisSchema.parse(hypothesisData)

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      content: `VIKRAM: Generated hypothetical goal assessment for discussion. Risk: ${validated.risk_profile}, Strategy: ${validated.strategy_framework}. Target corpus: ${validated.corpus_target_lakh}L.`,
      payload: {
        strategy_name: 'GOAL_HYPOTHESIS',
        rationale: `Hypothetical goal assessment for educational discussion. Risk: ${validated.risk_profile}, Strategy: ${validated.strategy_framework}.`,
        target_allocation:
          validated.risk_profile === 'AGGRESSIVE'
            ? { equity: 80, debt: 15, gold: 5 }
            : validated.risk_profile === 'CONSERVATIVE'
              ? { equity: 30, debt: 60, gold: 10 }
              : { equity: 60, debt: 30, gold: 10 },
        risk_level: validated.risk_profile,
        expected_return_band: [10, 15],
      },
      references: [],
    })

    const userId = clientData.userId || clientData.client_id || 'anonymous'
    await writeMemory(
      'VIKRAM',
      makePipelineKey('VIKRAM', 'goal_hypothesis', userId, pipelineRunId),
      {
        content: validated,
        memory_type: 'VIKRAM_GOAL_HYPOTHESIS',
        source_url: 'Internal',
        confidence_tier: 'ASSUMED',
        tags: [makePipelineKey('VIKRAM', 'goal_hypothesis', userId, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      userId,
    )

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: userId,
      agent_id: 'VIKRAM',
      action_type: AuditActionType.CLIENT_FACT_CONFIRMED,
      payload: {
        event: 'GOAL_HYPOTHESIS_GENERATED',
        risk_profile: validated.risk_profile,
        strategy_framework: validated.strategy_framework,
        confidence: validated.confidence,
      },
    })

    return validated
  }

  async applyCorrections(
    hypothesis: GoalHypothesis,
    corrections: string[] | UserCorrection[],
    pipelineRunId: string,
  ): Promise<GoalHypothesis> {
    logger.info({ pipelineRunId, count: corrections.length }, 'VIKRAM: applyCorrections invoked')

    const gpt = getGpt4oMini()
    const prompt = `
You are VIKRAM, the Market Strategist.
We have an existing financial GoalHypothesis and some user corrections.
Your task is to merge the corrections into the hypothesis and return the updated hypothesis JSON object.

Existing Hypothesis:
${JSON.stringify(hypothesis, null, 2)}

User Corrections:
${JSON.stringify(corrections, null, 2)}

Instructions:
1. Update any corresponding fields in the hypothesis (e.g. corpus_target_lakh, risk_profile, etc.) based on the user corrections.
2. In the "assumptions" array, update the values and reasoning if the user corrected an assumption.
3. Keep the "hypothesis_id" unchanged.
4. Recalculate any dependent fields:
   - Monthly SIP required: if they changed the target corpus, timeline, or monthly savings, adjust the required monthly SIP or CAGR.
   - If they updated rent or other assumed expenses, recalculate current_monthly_savings_lakh.
   - CAGR feasibility should reflect the required CAGR:
     - <=12% -> ACHIEVABLE
     - 12-18% -> AGGRESSIVE
     - >18% -> UNREALISTIC
5. Update confidence score based on corrections if needed (e.g., if many things were corrected, adjust it).

Return ONLY the updated GoalHypothesis JSON object. Do not include markdown code block formatting or backticks.
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You merge user corrections into a financial GoalHypothesis. Output only valid JSON matching the GoalHypothesis schema.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let updatedData: any
    try {
      updatedData = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'VIKRAM: Failed to parse updated hypothesis JSON')
      throw new Error('VIKRAM: Updated goal hypothesis is not valid JSON')
    }

    updatedData.hypothesis_id = hypothesis.hypothesis_id
    const validated = GoalHypothesisSchema.parse(updatedData)

    const userId = hypothesis.hypothesis_id
    await writeMemory(
      'VIKRAM',
      makePipelineKey('VIKRAM', 'goal_hypothesis_corrected', userId, pipelineRunId),
      {
        content: { hypothesis: validated, corrections },
        memory_type: 'VIKRAM_GOAL_HYPOTHESIS',
        source_url: 'Internal',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('VIKRAM', 'goal_hypothesis_corrected', userId, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      userId,
    )

    return validated
  }

  async buildClientGoalAssessment(
    hypothesis: GoalHypothesis,
    clientData: any,
    pipelineRunId: string,
    userCorrections: string[] = [],
  ): Promise<ClientGoalAssessment> {
    logger.info({ pipelineRunId }, 'VIKRAM: buildClientGoalAssessment invoked')

    const gpt = getGpt4oMini()
    const prompt = `
You are VIKRAM. Convert the following GoalHypothesis into a structured ClientGoalAssessment.
The output is a hypothetical assessment for educational discussion, not investment advice.

GoalHypothesis:
${JSON.stringify(hypothesis, null, 2)}

Client Data:
${JSON.stringify(clientData, null, 2)}

User Corrections Applied:
${JSON.stringify(userCorrections, null, 2)}

Instructions:
1. Produce a ClientGoalAssessment JSON object.
2. Decompose the biggest goal into a single DecomposedGoal with a generated goal_id if not present.
3. Set achievability_verdict to ALIGNS_WITH_GOALS, NEEDS_DISCUSSION, or OUT_OF_SCOPE based on required CAGR and monthly SIP feasibility.
4. Include any goal_sequence_conflicts you can infer.
5. Cite at least one source (e.g., SEBI or AMFI) with a retrieved_at timestamp.

Return ONLY valid JSON matching the ClientGoalAssessment schema. No markdown or backticks.
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: VIKRAM_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'VIKRAM: Failed to parse assessment JSON')
      throw new Error('VIKRAM: Client goal assessment is not valid JSON')
    }

    const clientId = clientData.client_id || clientData.userId || randomUUID()
    const now = new Date().toISOString()
    const assessment: ClientGoalAssessment = {
      assessment_id: parsed.assessment_id || randomUUID(),
      client_id: clientId,
      version: parsed.version || 1,
      assessed_at: parsed.assessed_at || now,
      expires_at:
        parsed.expires_at || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      stated_goals: parsed.stated_goals || [hypothesis.goal_description],
      decomposed_goals: (parsed.decomposed_goals || []).map((g: any) => ({
        goal_id: g.goal_id || randomUUID(),
        goal_type: g.goal_type || 'CUSTOM',
        description: g.description || hypothesis.goal_description,
        target_corpus_lakh: g.target_corpus_lakh ?? hypothesis.corpus_target_lakh,
        target_date: g.target_date || `${hypothesis.corpus_target_year}-01-01`,
        current_corpus_lakh: g.current_corpus_lakh ?? 0,
        monthly_sip_required_lakh: g.monthly_sip_required_lakh ?? hypothesis.monthly_sip_required_lakh,
        required_cagr_pct: g.required_cagr_pct ?? hypothesis.required_cagr_pct,
        inflation_adjusted_target_lakh: g.inflation_adjusted_target_lakh ?? hypothesis.corpus_target_lakh,
        inflation_rate_used_pct: g.inflation_rate_used_pct ?? 6,
      })),
      achievability_verdict: parsed.achievability_verdict || 'NEEDS_DISCUSSION',
      revised_plan: parsed.revised_plan,
      goal_sequence_conflicts: parsed.goal_sequence_conflicts || [],
      sources:
        parsed.sources && parsed.sources.length > 0
          ? parsed.sources
          : [{ url: 'https://sebi.gov.in', retrieved_at: now }],
      hypothesis_mode: true,
      user_corrections: userCorrections,
      correction_rounds: userCorrections.length,
    }

    const validated = ClientGoalAssessmentSchema.parse(assessment)

    await writeMemory(
      'VIKRAM',
      makePipelineKey('VIKRAM', 'goal_assessment', clientId, pipelineRunId),
      {
        content: validated,
        memory_type: 'VIKRAM_GOAL_HYPOTHESIS',
        source_url: 'Internal',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('VIKRAM', 'goal_assessment', clientId, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      clientId,
    )

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      content: `VIKRAM: Client goal assessment ready for discussion. Verdict: ${validated.achievability_verdict}.`,
      payload: {
        assessment_id: validated.assessment_id,
        achievability_verdict: validated.achievability_verdict,
        decomposed_goals: validated.decomposed_goals.map((g: DecomposedGoal) => ({
          goal_id: g.goal_id,
          target_corpus_lakh: g.target_corpus_lakh,
          monthly_sip_required_lakh: g.monthly_sip_required_lakh,
        })),
      },
      references: [],
    })

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: clientId,
      agent_id: 'VIKRAM',
      action_type: AuditActionType.CLIENT_FACT_CONFIRMED,
      payload: {
        event: 'CLIENT_GOAL_ASSESSMENT_BUILT',
        assessment_id: validated.assessment_id,
        achievability_verdict: validated.achievability_verdict,
      },
    })

    return validated
  }

  async selectStrategyFramework(
    riskProfile: ClientRiskProfile,
    assessment: ClientGoalAssessment,
    pipelineRunId: string,
    researchContext = '',
    behavioralFingerprint?: any,
  ): Promise<StrategyFramework> {
    logger.info({ pipelineRunId, assessmentId: assessment.assessment_id }, 'VIKRAM: selectStrategyFramework invoked')

    const gpt = getGpt4oMini()
    let prompt = `
Select the most appropriate investment strategy frameworks (core-satellite, bucket strategy, goal-based, liability-matching) for the client.
You must return a valid JSON object ONLY. Do not include markdown.
This is a hypothetical strategy discussion draft, not a recommendation to transact.

Client Risk Profile:
${JSON.stringify(riskProfile, null, 2)}

Goal Assessment:
${JSON.stringify(assessment, null, 2)}

Research Context:
${researchContext}
`

    if (behavioralFingerprint) {
      const guidance = Array.isArray(behavioralFingerprint.constructionGuidance)
        ? behavioralFingerprint.constructionGuidance.join(', ')
        : ''
      prompt += `
RIYA's behavioral assessment: ${guidance}.
Adjust your strategy framework recommendation accordingly.
`
      if (behavioralFingerprint.riskToleranceReality === 'LOWER_THAN_STATED') {
        prompt += `
IMPORTANT: RIYA has assessed that the client's actual risk tolerance is LOWER THAN STATED. You must adjust your strategy framework selection towards more conservative options.
`
      }
    }

    prompt += `
JSON Schema:
{
  "selected_frameworks": [
    {
      "name": string,
      "description": string,
      "why_applicable": string,
      "source_url": string
    }
  ],
  "asset_allocation_guidance": {
    "equity_pct_range": [number, number],
    "debt_pct_range": [number, number],
    "gold_pct_range": [number, number],
    "international_pct_range": [number, number]
  }
}
`

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: VIKRAM_SYSTEM_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = cleanAndParseJson(rawText)
    } catch (e) {
      logger.error({ rawText, err: e }, 'VIKRAM: Failed to parse strategy framework JSON')
      throw new Error('VIKRAM: Strategy framework is not valid JSON')
    }

    const now = new Date()
    const framework: StrategyFramework = {
      framework_id: randomUUID(),
      client_id: assessment.client_id,
      selected_frameworks: (parsed.selected_frameworks || []).map((f: any) => ({
        ...f,
        retrieved_at: now.toISOString(),
        source_url: f.source_url || 'https://sebi.gov.in',
      })),
      asset_allocation_guidance: parsed.asset_allocation_guidance || {
        equity_pct_range: [50, 70],
        debt_pct_range: [20, 30],
        gold_pct_range: [5, 10],
        international_pct_range: [0, 10],
      },
    }

    const validated = StrategyFrameworkSchema.parse(framework)

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      content: `VIKRAM selected strategy frameworks for discussion: ${validated.selected_frameworks.map((f) => f.name).join(', ')}.`,
      payload: {
        strategy_name: validated.selected_frameworks.map((f) => f.name).join(', '),
        rationale: `VIKRAM selected strategy: ${validated.selected_frameworks[0]?.description || 'Goal-based asset allocation'}. Guidances: Equity ${validated.asset_allocation_guidance.equity_pct_range.join('-')}%, Debt ${validated.asset_allocation_guidance.debt_pct_range.join('-')}%.`,
        target_allocation: {
          equity:
            (validated.asset_allocation_guidance.equity_pct_range[0] +
              validated.asset_allocation_guidance.equity_pct_range[1]) /
            2,
          debt:
            (validated.asset_allocation_guidance.debt_pct_range[0] +
              validated.asset_allocation_guidance.debt_pct_range[1]) /
            2,
          gold:
            (validated.asset_allocation_guidance.gold_pct_range[0] +
              validated.asset_allocation_guidance.gold_pct_range[1]) /
            2,
        },
        risk_level:
          riskProfile.behavioural_risk_tolerance === 'HIGH'
            ? 'AGGRESSIVE'
            : riskProfile.behavioural_risk_tolerance === 'LOW'
              ? 'CONSERVATIVE'
              : 'MODERATE',
        expected_return_band: [11.0, 14.5],
      },
      references: [],
    })

    await writeMemory(
      'VIKRAM',
      makePipelineKey('VIKRAM', 'strategy_framework', validated.client_id, pipelineRunId),
      {
        content: validated,
        memory_type: 'VIKRAM_STRATEGY_FRAMEWORK',
        source_url: validated.selected_frameworks[0]?.source_url || 'Internal',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('VIKRAM', 'strategy_framework', validated.client_id, pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
      validated.client_id,
    )

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: validated.client_id,
      agent_id: 'VIKRAM',
      action_type: AuditActionType.CLIENT_FACT_CONFIRMED,
      payload: {
        event: 'STRATEGY_FRAMEWORK_SELECTED',
        framework_id: validated.framework_id,
        frameworks: validated.selected_frameworks.map((f) => f.name),
      },
    })

    return validated
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('VIKRAM: starting weekly strategy sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text:
            'goal based asset allocation strategies factor investing emerging markets SEBI updates John Bogle portfolio guidelines',
          intent: 'weekly_sweep_strategy',
          freshness_required_days: 7,
          max_sources: 4,
          memory_type: 'VIKRAM_STRATEGY_FRAMEWORK',
        },
        'WEEKLY_RESEARCH',
      )
      logger.info('VIKRAM: weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'VIKRAM: weekly sweep research failed')
    }
  }
}
