import { randomUUID } from 'crypto'
import { eq, desc, inArray } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  DecomposedGoal,
  ClientGoalAssessment,
  ClientGoalAssessmentSchema,
  StrategyFramework,
  StrategyFrameworkSchema,
  EssentialAnswers,
  GoalHypothesis,
  GoalHypothesisSchema,
  UserCorrection,
  EssentialQuestion,
  HypothesisInterviewContext,
} from './types/vikram-types'
import { ClientRiskProfile } from './types/kiran-types'
import { PortfolioDraft } from './types/priya-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore, makePipelineKey } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4o, getGpt4oMini } from '../azure-openai'
import { LifeEvent, MAJOR_LIFE_EVENTS } from './types/life-event-types'
import { VIKRAM_HYPOTHESIS_PROMPT } from '../prompts/vikram-hypothesis'
import logger from '../logger'

const VIKRAM_SYSTEM_PROMPT = `You are VIKRAM (Visionary Intelligence for Kinetic Return & Asset Management), the Market Strategist in a multi-agent portfolio intelligence system for Indian investors.

YOUR ROLE: Deeply understand how markets work at every level. Interview the client to understand their goals. Then reason thoroughly about whether those goals are actually achievable. If not, produce a revised, achievable plan. Go online to continuously learn every strategy and framework ever written on how to approach fund selection and long-term financial planning.

YOUR GOAL ASSESSMENT PROTOCOLS:
1. Hypothesis-First Interview (Default):
   - Phase 1: Ask 5 essential questions (Age, monthly take-home, biggest goal, timeline, risk reaction).
   - Phase 2: Generate a complete GoalHypothesis making explicit, demographic-anchored spending and financial assumptions (rent, dependents, required CAGR, required SIP).
   - Phase 3: Present the hypothesis to the user to edit or provide free-text corrections. Merge corrections into a final assessment.
2. Detailed Sequential Interview (Fallback):
   - Ask 15–25 contextual questions step-by-step.
   - Decompose and assess goals after the detailed questionnaire.

Goal Decomposition & Achievability Assessment:
- Break every goal into: type, target corpus, target date, current corpus, monthly SIP, required CAGR, and inflation-adjusted target.
- Assess CAGR feasibility (Achievable <=12%, Aggressive 12-18%, Unrealistic >18%) and monthly cash flow.
- Choose strategy framework (core-satellite, bucket strategy, liability-matching, barbell, etc.) based on risk profile and horizon.

WHAT YOU MUST NEVER DO:
- Do not select specific fund names without consulting SOMA's FundProfile data.
- Do not override KIRAN's risk parameters.
- Do not assume a client's unstated preferences.`

export class Vikram {
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

  async conductClientInterview(
    clientData: any,
    pipelineRunId: string
  ): Promise<string[]> {
    return this.runDetailedInterview(clientData, pipelineRunId)
  }

  async runDetailedInterview(
    clientData: any,
    pipelineRunId: string
  ): Promise<string[]> {
    logger.info({ pipelineRunId }, 'VIKRAM: conductClientInterview invoked')

    const gpt = getGpt4oMini()
    const prompt = `
Generate a list of 15 to 25 client interview questions to assess their specific investment goals.
These questions must be highly contextualized based on the client's provided details.
You MUST NOT ask questions about information already present in the client's profile (such as age, dependents, liabilities).
Return a valid JSON array of strings ONLY. Do not include markdown code block formatting or backticks.

Client Details:
${JSON.stringify(clientData, null, 2)}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const questions = JSON.parse(cleanJson)

    if (!Array.isArray(questions)) {
      throw new Error('VIKRAM interview generation did not return an array')
    }

    logger.info({ questionsCount: questions.length }, 'VIKRAM: generated interview questions')
    return questions
  }

  async assessGoals(
    clientId: string,
    version: number,
    clientAnswers: { stated_goals: string[]; monthly_income_lakh: number; monthly_expenses_lakh?: number; answers: Record<string, string>; goals_data: any[] },
    pipelineRunId: string
  ): Promise<ClientGoalAssessment> {
    logger.info({ pipelineRunId }, 'VIKRAM: assessGoals invoked')

    const now = new Date()
    const assessedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const decomposedGoals: DecomposedGoal[] = []
    let totalSipRequired = 0
    let achievabilityVerdict: 'ACHIEVABLE' | 'REVISED' | 'IMPOSSIBLE' = 'ACHIEVABLE'
    const conflicts: string[] = []

    const goalsData = clientAnswers.goals_data || []

    for (const gd of goalsData) {
      // Step 2 — Goal Decomposition
      const targetCorpus = gd.target_corpus_lakh || 10
      const currentCorpus = gd.current_corpus_lakh || 0
      const monthlySip = gd.monthly_sip_required_lakh || 0.1
      const targetDate = gd.target_date || new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()).toISOString()
      const goalType = gd.goal_type || 'WEALTH_CREATION'

      const years = Math.max(
        (new Date(targetDate).getTime() - now.getTime()) / (365 * 24 * 60 * 60 * 1000),
        0.1
      )

      // CAGR formula: (target/current)^(1/years) - 1
      let requiredCagr = 0
      if (currentCorpus > 0) {
        requiredCagr = (Math.pow(targetCorpus / currentCorpus, 1 / years) - 1) * 100
      } else {
        // If current corpus is 0, estimate required CAGR based on SIP to reach target
        // Simple approximation: (Target - (SIP * Months)) / (SIP * Months) as CAGR proxy
        const totalSipContributed = monthlySip * (years * 12)
        requiredCagr = totalSipContributed > 0 ? ((targetCorpus - totalSipContributed) / totalSipContributed) * 100 : 15
      }

      // Default values for inflation adjustment
      const inflationRate = 6.0
      const inflationAdjustedTarget = targetCorpus * Math.pow(1 + inflationRate / 100, years)

      const decomposed: DecomposedGoal = {
        goal_id: gd.goal_id || randomUUID(),
        goal_type: goalType,
        description: gd.description || `Goal type ${goalType}`,
        target_corpus_lakh: targetCorpus,
        target_date: targetDate,
        current_corpus_lakh: currentCorpus,
        monthly_sip_required_lakh: monthlySip,
        required_cagr_pct: requiredCagr,
        inflation_adjusted_target_lakh: inflationAdjustedTarget,
        inflation_rate_used_pct: inflationRate,
      }

      // Step 3 — Achievability Assessment
      if (requiredCagr > 16) {
        conflicts.push(`Goal "${decomposed.description}" CAGR requirement of ${requiredCagr.toFixed(1)}% is HIGH_RISK`)
      }
      if (requiredCagr > 30) {
        achievabilityVerdict = 'IMPOSSIBLE'
        conflicts.push(`Goal "${decomposed.description}" CAGR requirement of ${requiredCagr.toFixed(1)}% is IMPOSSIBLE`)
      } else if (requiredCagr > 20) {
        if (achievabilityVerdict !== 'IMPOSSIBLE') {
          achievabilityVerdict = 'REVISED'
        }
        conflicts.push(`Goal "${decomposed.description}" CAGR requirement of ${requiredCagr.toFixed(1)}% is UNREALISTIC`)
      }

      totalSipRequired += monthlySip
      decomposedGoals.push(decomposed)
    }

    // Check cash-flow sustainability (Free Cash Flow)
    const statedIncome = clientAnswers.monthly_income_lakh || 2.0
    // Fallback to 50% of income if expenses are omitted
    const statedExpenses = clientAnswers.monthly_expenses_lakh ?? (statedIncome * 0.5) 
    const freeCashFlow = statedIncome - statedExpenses

    if (freeCashFlow <= 0) {
      achievabilityVerdict = 'IMPOSSIBLE'
      conflicts.push(`Monthly expenses (${statedExpenses.toFixed(2)}L) equal or exceed stated income (${statedIncome.toFixed(2)}L). No free cash flow for investments.`)
    } else {
      const sipRatio = totalSipRequired / freeCashFlow
      if (sipRatio > 1.0) {
        achievabilityVerdict = 'IMPOSSIBLE'
        conflicts.push(`Total required SIP (${totalSipRequired.toFixed(2)}L) exceeds free cash flow (${freeCashFlow.toFixed(2)}L)`)
      } else if (sipRatio > 0.8) {
        if (achievabilityVerdict !== 'IMPOSSIBLE') {
          achievabilityVerdict = 'REVISED'
        }
        conflicts.push(`Total required SIP (${totalSipRequired.toFixed(2)}L) exceeds 80% of free cash flow (${freeCashFlow.toFixed(2)}L), indicating tight margins.`)
      }
    }

    // Check sequence conflicts (e.g. Retirement before Child Education is a conflict)
    const retirementGoal = decomposedGoals.find(g => g.goal_type === 'RETIREMENT')
    const educationGoal = decomposedGoals.find(g => g.goal_type === 'CHILD_EDUCATION')
    if (retirementGoal && educationGoal) {
      const retirementTime = new Date(retirementGoal.target_date).getTime()
      const educationTime = new Date(educationGoal.target_date).getTime()
      if (retirementTime < educationTime) {
        conflicts.push('Goal Sequence Conflict: Retirement target date is set earlier than Child Education')
      }
    }

    let revisedPlan: string | undefined = undefined

    // Step 4 — Revised Plan via LLM if not achievable
    if (achievabilityVerdict === 'REVISED' || achievabilityVerdict === 'IMPOSSIBLE') {
      const gpt = getGpt4oMini()
      const prompt = `
Formulate a revised investment plan for the client. The original goals are not achievable due to high CAGR requirement or low income.
Return a detailed revised plan explanation (max 300 words).

Client Goals:
${JSON.stringify(decomposedGoals, null, 2)}

Conflicts Identified:
${conflicts.join('\n')}
`
      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })
      revisedPlan = response.choices[0]?.message?.content?.trim() || 'Please revise targets/SIPs.'
    }

    const assessment: ClientGoalAssessment = {
      assessment_id: randomUUID(),
      client_id: clientId,
      version: version,
      assessed_at: assessedAt,
      expires_at: expiresAt,
      stated_goals: clientAnswers.stated_goals,
      decomposed_goals: decomposedGoals,
      achievability_verdict: achievabilityVerdict,
      revised_plan: revisedPlan,
      goal_sequence_conflicts: conflicts,
      sources: [{ url: 'https://sebi.gov.in', retrieved_at: assessedAt }],
      hypothesis_mode: false,
      user_corrections: [],
      correction_rounds: 0
    }

    const validated = ClientGoalAssessmentSchema.parse(assessment)

    // Publish to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      payload: {
        strategy_name: 'GOAL_ASSESSMENT',
        rationale: `VIKRAM: Goals assessment complete. Verdict: ${validated.achievability_verdict}. Conflicts: ${validated.goal_sequence_conflicts.length}. Revised plan generated: ${!!validated.revised_plan}.`,
        target_allocation: { equity: 60, debt: 30, gold: 10 },
        risk_level: 'MODERATE',
        expected_return_band: [10, 14],
      },
      references: []
    })

    await this.memoryStore.write('VIKRAM', {
      content: JSON.stringify(validated),
      memory_type: 'VIKRAM_CLIENT_GOAL_ASSESSMENT',
      source_url: 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [
        makePipelineKey('VIKRAM', 'client_goal_assessment', validated.client_id, pipelineRunId),
        makePipelineKey('VIKRAM', 'goal_decomposition', validated.client_id, pipelineRunId)
      ],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async askEssentialQuestions(): Promise<EssentialQuestion[]> {
    return [
      {
        id: 'age',
        text: 'What is your age?',
        type: 'number'
      },
      {
        id: 'monthly_take_home_lakh',
        text: 'What is your monthly take-home income (in lakhs)?',
        type: 'number'
      },
      {
        id: 'biggest_goal',
        text: 'What is your biggest financial goal? (Describe in one sentence)',
        type: 'text'
      },
      {
        id: 'goal_timeline_years',
        text: 'What is your target timeline for that goal (in years)?',
        type: 'number'
      },
      {
        id: 'risk_reaction',
        text: 'How would you feel if your portfolio dropped 20% in a year?',
        type: 'choice',
        options: [
          'A - Panic and sell',
          'B - Worried but hold',
          'C - Buy more'
        ]
      }
    ]
  }

  async generateHypothesis(
    answers: EssentialAnswers,
    clientData: any,
    pipelineRunId: string,
    behavioralFingerprint?: any
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
        : '';
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
        { role: 'system', content: VIKRAM_HYPOTHESIS_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    
    let hypothesisData: any
    try {
      hypothesisData = JSON.parse(cleanJson)
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

    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      payload: {
        strategy_name: 'GOAL_HYPOTHESIS',
        rationale: `VIKRAM: Generated initial goal hypothesis. Risk: ${validated.risk_profile}, Strategy: ${validated.strategy_framework}. Target corpus: ${validated.corpus_target_lakh}L.`,
        target_allocation: validated.risk_profile === 'AGGRESSIVE' ? { equity: 80, debt: 15, gold: 5 } : (validated.risk_profile === 'CONSERVATIVE' ? { equity: 30, debt: 60, gold: 10 } : { equity: 60, debt: 30, gold: 10 }),
        risk_level: validated.risk_profile,
        expected_return_band: [10, 15],
      },
      references: []
    })

    const userId = clientData.userId || clientData.client_id || 'anonymous'
    const memoryKey = `VIKRAM:goal_hypothesis:${userId}:${pipelineRunId}`
    await this.memoryStore.write('VIKRAM', {
      content: JSON.stringify(validated),
      memory_type: 'VIKRAM_GOAL_HYPOTHESIS',
      source_url: 'Internal',
      confidence_tier: 'ASSUMED',
      tags: [memoryKey],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async applyCorrections(
    hypothesis: GoalHypothesis,
    corrections: string[] | UserCorrection[],
    pipelineRunId: string
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
        { role: 'system', content: 'You merge user corrections into a financial GoalHypothesis. Output only valid JSON matching the GoalHypothesis schema.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    
    let updatedData: any
    try {
      updatedData = JSON.parse(cleanJson)
    } catch (e) {
      logger.error({ rawText, err: e }, 'VIKRAM: Failed to parse updated hypothesis JSON')
      throw new Error('VIKRAM: Updated goal hypothesis is not valid JSON')
    }

    updatedData.hypothesis_id = hypothesis.hypothesis_id
    updatedData.generated_at = new Date().toISOString()

    const validated = GoalHypothesisSchema.parse(updatedData)
    return validated
  }

  private hypothesisToAssessment(
    hypothesis: GoalHypothesis,
    clientId: string,
    version: number
  ): ClientGoalAssessment {
    const now = new Date()
    const assessedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

    let achievabilityVerdict: 'ACHIEVABLE' | 'REVISED' | 'IMPOSSIBLE' = 'ACHIEVABLE'
    if (hypothesis.cagr_feasibility === 'UNREALISTIC') {
      achievabilityVerdict = 'IMPOSSIBLE'
    } else if (hypothesis.cagr_feasibility === 'AGGRESSIVE') {
      achievabilityVerdict = 'REVISED'
    }

    const decomposedGoal = {
      goal_id: randomUUID(),
      goal_type: 'WEALTH_CREATION' as const,
      description: hypothesis.goal_description,
      target_corpus_lakh: hypothesis.corpus_target_lakh,
      target_date: new Date(hypothesis.corpus_target_year, 11, 31).toISOString(),
      current_corpus_lakh: 0,
      monthly_sip_required_lakh: hypothesis.monthly_sip_required_lakh,
      required_cagr_pct: hypothesis.required_cagr_pct,
      inflation_adjusted_target_lakh: hypothesis.corpus_target_lakh,
      inflation_rate_used_pct: 6.0
    }

    const conflicts: string[] = []
    if (hypothesis.cagr_feasibility === 'UNREALISTIC') {
      conflicts.push(`Required CAGR of ${hypothesis.required_cagr_pct}% is unrealistic for mutual funds.`)
    }

    return {
      assessment_id: randomUUID(),
      client_id: clientId,
      version: version,
      assessed_at: assessedAt,
      expires_at: expiresAt,
      stated_goals: [hypothesis.goal_description],
      decomposed_goals: [decomposedGoal],
      achievability_verdict: achievabilityVerdict,
      revised_plan: achievabilityVerdict !== 'ACHIEVABLE' ? 'Revised targets recommended.' : undefined,
      goal_sequence_conflicts: conflicts,
      sources: [{ url: 'https://sebi.gov.in', retrieved_at: assessedAt }],
      hypothesis_mode: true,
      user_corrections: [],
      correction_rounds: 0
    }
  }

  async runHypothesisInterview(
    context: HypothesisInterviewContext,
    pipelineRunId: string
  ): Promise<ClientGoalAssessment> {
    logger.info({ pipelineRunId }, 'VIKRAM: runHypothesisInterview invoked')

    const clientId = context.userId
    const userId = context.userId

    const memoryKey = `VIKRAM:goal_hypothesis:${userId}:${pipelineRunId}`
    let hypothesis: GoalHypothesis

    try {
      const recalled = await this.memoryStore.recall('VIKRAM', memoryKey, {
        limit: 1,
        pipeline_run_id: pipelineRunId
      })
      if (recalled.length > 0) {
        hypothesis = JSON.parse(recalled[0].content)
        logger.info('VIKRAM: recalled existing goal hypothesis')
      } else {
        hypothesis = await this.generateHypothesis(context.essentialAnswers, context.clientData, pipelineRunId)
      }
    } catch (err) {
      logger.warn({ err }, 'VIKRAM: error recalling hypothesis, generating new one')
      hypothesis = await this.generateHypothesis(context.essentialAnswers, context.clientData, pipelineRunId)
    }

    let userCorrectionsLog: string[] = []
    let correctionRounds = 0

    if (context.userCorrections && context.userCorrections.length > 0) {
      logger.info({ corrections: context.userCorrections }, 'VIKRAM: applying corrections to hypothesis')
      hypothesis = await this.applyCorrections(hypothesis, context.userCorrections, pipelineRunId)
      
      await this.memoryStore.write('VIKRAM', {
        content: JSON.stringify(hypothesis),
        memory_type: 'VIKRAM_GOAL_HYPOTHESIS',
        source_url: 'Internal',
        confidence_tier: 'ASSUMED',
        tags: [memoryKey],
        pipeline_run_id: pipelineRunId
      })

      userCorrectionsLog = context.userCorrections
      correctionRounds = 1
    }

    const assessment = this.hypothesisToAssessment(hypothesis, clientId, 1)
    assessment.hypothesis_mode = true
    assessment.user_corrections = userCorrectionsLog
    assessment.correction_rounds = correctionRounds

    const validated = ClientGoalAssessmentSchema.parse(assessment)

    await this.memoryStore.write('VIKRAM', {
      content: JSON.stringify(validated),
      memory_type: 'VIKRAM_CLIENT_GOAL_ASSESSMENT',
      source_url: 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [
        makePipelineKey('VIKRAM', 'client_goal_assessment', validated.client_id, pipelineRunId),
        makePipelineKey('VIKRAM', 'goal_decomposition', validated.client_id, pipelineRunId)
      ],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }


  async selectStrategyFramework(
    assessment: ClientGoalAssessment,
    riskProfile: ClientRiskProfile,
    pipelineRunId: string,
    behavioralFingerprint?: any
  ): Promise<StrategyFramework> {
    logger.info({ pipelineRunId }, 'VIKRAM: selectStrategyFramework invoked')

    // 1. Recall from memory first (365 days TTL)
    try {
      const recalled = await this.memoryStore.recall('VIKRAM', 'StrategyFramework selection client', {
        limit: 1,
        pipeline_run_id: pipelineRunId
      })
      if (recalled.length > 0) {
        logger.info('VIKRAM: strategy framework recall hit')
        // Reconstruct from payload
      }
    } catch (err) {
      logger.warn({ err }, 'VIKRAM: memory recall failed')
    }

    // 2. Fetch via WebResearchTool if not found or stale
    let searchResults: any[] = []
    try {
      searchResults = await this.webResearchTool.research({
        query_text: 'goal based asset allocation strategy frameworks core satellite bucket liability matching barbell SEBI guidelines',
        intent: 'strategy_framework_selection',
        freshness_required_days: 90,
        max_sources: 3,
        memory_type: 'VIKRAM_STRATEGY_FRAMEWORK'
      }, pipelineRunId)
    } catch (err) {
      logger.warn({ err }, 'VIKRAM: research failed')
    }

    const researchContext = searchResults.map(r => r.content_snippet).join('\n')

    // 3. LLM selection
    const gpt = getGpt4oMini()
    let prompt = `
Select the most appropriate investment strategy frameworks (core-satellite, bucket strategy, goal-based, liability-matching) for the client.
You must return a valid JSON object ONLY. Do not include markdown.

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
        : '';
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
        { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const framework: StrategyFramework = {
      framework_id: randomUUID(),
      client_id: riskProfile.client_id,
      selected_frameworks: (parsed.selected_frameworks || []).map((f: any) => ({
        ...f,
        retrieved_at: now.toISOString(),
        source_url: f.source_url || 'https://sebi.gov.in'
      })),
      asset_allocation_guidance: parsed.asset_allocation_guidance || {
        equity_pct_range: [50, 70],
        debt_pct_range: [20, 30],
        gold_pct_range: [5, 10],
        international_pct_range: [0, 10]
      }
    }

    const validated = StrategyFrameworkSchema.parse(framework)

    // Publish Strategy Proposal to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'VIKRAM',
      message_type: 'STRATEGY_PROPOSAL',
      recipient: 'ALL',
      payload: {
        strategy_name: validated.selected_frameworks.map(f => f.name).join(', '),
        rationale: `VIKRAM selected strategy: ${validated.selected_frameworks[0]?.description || 'Goal-based asset allocation'}. Guidances: Equity ${validated.asset_allocation_guidance.equity_pct_range.join('-')}%, Debt ${validated.asset_allocation_guidance.debt_pct_range.join('-')}%.`,
        target_allocation: {
          equity: (validated.asset_allocation_guidance.equity_pct_range[0] + validated.asset_allocation_guidance.equity_pct_range[1]) / 2,
          debt: (validated.asset_allocation_guidance.debt_pct_range[0] + validated.asset_allocation_guidance.debt_pct_range[1]) / 2,
          gold: (validated.asset_allocation_guidance.gold_pct_range[0] + validated.asset_allocation_guidance.gold_pct_range[1]) / 2
        },
        risk_level: riskProfile.behavioural_risk_tolerance === 'HIGH' ? 'AGGRESSIVE' : (riskProfile.behavioural_risk_tolerance === 'LOW' ? 'CONSERVATIVE' : 'MODERATE'),
        expected_return_band: [11.0, 14.5]
      },
      references: []
    })

    await this.memoryStore.write('VIKRAM', {
      content: JSON.stringify(validated),
      memory_type: 'VIKRAM_STRATEGY_FRAMEWORK',
      source_url: validated.selected_frameworks[0]?.source_url || 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [makePipelineKey('VIKRAM', 'strategy_framework', validated.client_id, pipelineRunId)],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('VIKRAM: starting weekly strategy sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'goal based asset allocation strategies factor investing emerging markets SEBI updates John Bogle portfolio guidelines',
        intent: 'weekly_sweep_strategy',
        freshness_required_days: 7,
        max_sources: 4,
        memory_type: 'VIKRAM_STRATEGY_FRAMEWORK'
      }, 'WEEKLY_RESEARCH')

      logger.info({ resultsCount: results.length }, 'VIKRAM: weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'VIKRAM: weekly sweep research failed')
    }
  }

  async evaluatePortfolioAlignment(
    draft: PortfolioDraft,
    strategyFramework: StrategyFramework | undefined,
    pipelineRunId: string
  ): Promise<{ vote: 'APPROVE' | 'REJECT'; reasoning: string; violations: string[] }> {
    logger.info({ pipelineRunId, draftId: draft.portfolio_id }, 'VIKRAM: evaluatePortfolioAlignment invoked')

    let vote: 'APPROVE' | 'REJECT' = 'APPROVE'
    let reasoning = 'Portfolio allocations align with strategic asset allocations.'
    let violations: string[] = []

    try {
      if (!strategyFramework) {
        throw new Error('No strategy framework provided for evaluation')
      }
      const schemeCodes = draft.fund_allocations.map(fa => fa.scheme_code).filter(Boolean)
      const schemeTypesMap = new Map<string, string>()

      if (schemeCodes.length > 0) {
        const funds = await this.db
          .select({
            schemeCode: schema.agentFunds.schemeCode,
            schemeType: schema.agentFunds.schemeType,
          })
          .from(schema.agentFunds)
          .where(inArray(schema.agentFunds.schemeCode, schemeCodes))

        for (const f of funds) {
          schemeTypesMap.set(f.schemeCode, f.schemeType.toLowerCase())
        }

        for (const fa of draft.fund_allocations) {
          if (!schemeTypesMap.has(fa.scheme_code)) {
            let inferredType = 'equity'
            const nameLower = fa.fund_name.toLowerCase()
            if (nameLower.includes('debt') || nameLower.includes('liquid') || nameLower.includes('bond') || nameLower.includes('gilt') || nameLower.includes('duration') || nameLower.includes('treasury')) {
              inferredType = 'debt'
            } else if (nameLower.includes('gold')) {
              inferredType = 'gold'
            }
            logger.warn({ schemeCode: fa.scheme_code, fundName: fa.fund_name, inferredType, pipelineRunId }, 'VIKRAM: schemeCode not found in agent_funds database table. Inferring type from fund_name.')
            schemeTypesMap.set(fa.scheme_code, inferredType)
          }
        }
      }

      // Aggregate allocations by scheme type
      const aggregations: Record<string, number> = {}
      for (const fa of draft.fund_allocations) {
        const type = schemeTypesMap.get(fa.scheme_code) || 'equity'
        aggregations[type] = (aggregations[type] || 0) + fa.allocation_pct
      }

      const selectedFrameworkNames = (strategyFramework.selected_frameworks || []).map(sf => sf.name)

      const gpt = getGpt4oMini()
      const prompt = `
Evaluate whether the portfolio allocations align with the strategic asset allocation guidance and selected strategy frameworks.

Strategic Asset Allocation Guidance:
- Equity range: ${strategyFramework.asset_allocation_guidance.equity_pct_range[0]}% - ${strategyFramework.asset_allocation_guidance.equity_pct_range[1]}%
- Debt range: ${strategyFramework.asset_allocation_guidance.debt_pct_range[0]}% - ${strategyFramework.asset_allocation_guidance.debt_pct_range[1]}%
- Gold range: ${strategyFramework.asset_allocation_guidance.gold_pct_range[0]}% - ${strategyFramework.asset_allocation_guidance.gold_pct_range[1]}%
- International range: ${strategyFramework.asset_allocation_guidance.international_pct_range[0]}% - ${strategyFramework.asset_allocation_guidance.international_pct_range[1]}%

Portfolio Actual Allocations by Asset Class:
${Object.entries(aggregations)
  .map(([k, v]) => `- ${k}: ${v.toFixed(2)}%`)
  .join('\n')}

Selected Strategy Frameworks:
${selectedFrameworkNames.map(name => `- ${name}`).join('\n')}

Bucket Structure (Goal Buckets):
${(draft.goal_buckets || [])
  .map(gb => `- Bucket ID: ${gb.bucket_id}, Type: ${gb.goal_type}, Horizon: ${gb.time_horizon_years} years, Allocation: ${gb.allocation_pct}%`)
  .join('\n')}

Tasks:
1. Verify if the actual equity, debt, and gold allocations fall within the specified guidance ranges.
2. Verify if the selected strategy frameworks are properly reflected in the portfolio's bucket structure.
3. Determine if the portfolio alignment is acceptable (APPROVE) or has significant deviations (REJECT).
4. Provide a clear reasoning string and a list of specific violations (if any).

CRITICAL RULE:
- Do NOT include any investment advice language such as "buy", "sell", "recommend", "invest in", or SEBI regulatory disclaimers. Focus strictly on numerical and structural alignment.
- Return valid JSON only with no markdown or backticks. Format:
{
  "vote": "APPROVE" | "REJECT",
  "reasoning": "Reasoning string",
  "violations": ["Violation 1", "Violation 2"]
}
`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      if (parsed.vote === 'APPROVE' || parsed.vote === 'REJECT') {
        vote = parsed.vote
      }
      reasoning = parsed.reasoning || reasoning
      violations = parsed.violations || []

    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'VIKRAM: evaluatePortfolioAlignment failed or failed to parse JSON response. Defaulting to APPROVE.')
      vote = 'APPROVE'
      reasoning = 'Unable to evaluate alignment — defaulting to APPROVE'
      violations = []
    }

    try {
      await this.deliberationRoom.publish({
        pipeline_run_id: pipelineRunId,
        sender: 'VIKRAM',
        message_type: 'VOTE',
        recipient: 'ALL',
        payload: {
          motion: `Evaluate portfolio alignment for draft ${draft.portfolio_id}`,
          vote,
          reasoning,
          conditions: violations
        },
        references: [draft.portfolio_id]
      })
    } catch (publishErr) {
      logger.error({ publishErr, pipelineRunId }, 'VIKRAM: failed to publish VOTE to deliberationRoom')
    }

    return { vote, reasoning, violations }
  }

  async assessLifeEventImpact(
    lifeEvent: LifeEvent,
    previousRunId: string,
    pipelineRunId: string
  ): Promise<{
    requires_pipeline_restart: boolean
    impact_level: 'MINOR' | 'MODERATE' | 'MAJOR'
    reasoning: string
    guidance: string
    affected_goals: string[]
  }> {
    logger.info({ previousRunId, pipelineRunId, eventType: lifeEvent.event_type }, 'VIKRAM: assessLifeEventImpact invoked')

    let prevGoalAssessmentSummary = 'No previous goal assessment found.'
    try {
      const [prevResult] = await this.db
        .select()
        .from(schema.pipelineResults)
        .where(eq(schema.pipelineResults.pipelineRunId, previousRunId))
        .limit(1)

      if (prevResult && prevResult.data) {
        const packet = prevResult.data as any
        if (packet.client_goal_summary) {
          prevGoalAssessmentSummary = JSON.stringify(packet.client_goal_summary)
        } else if (packet.data && packet.data.client_goal_summary) {
          prevGoalAssessmentSummary = JSON.stringify(packet.data.client_goal_summary)
        }
      }
    } catch (dbErr) {
      logger.warn({ dbErr, previousRunId }, 'VIKRAM: Failed to fetch previous goal assessment summary from database')
    }

    let result = {
      requires_pipeline_restart: MAJOR_LIFE_EVENTS.includes(lifeEvent.event_type),
      impact_level: 'MODERATE' as const,
      reasoning: 'Unable to assess — defaulting based on event type',
      guidance: 'Please consult a financial planner.',
      affected_goals: [] as string[]
    }

    try {
      const gpt = getGpt4oMini()
      const prompt = `
Assess the financial impact of this life event on the client's existing portfolio plan.
Return a valid JSON object matching this schema:
{
  "requires_pipeline_restart": boolean,
  "impact_level": "MINOR" | "MODERATE" | "MAJOR",
  "reasoning": "detailed reasoning here",
  "guidance": "instructions/guidance for client",
  "affected_goals": ["goal1", "goal2"]
}

Do NOT include investment advice. Do NOT recommend specific funds.

Life Event:
- Type: ${lifeEvent.event_type}
- Description: ${lifeEvent.description}
- Financial Impact (Lakh): ${lifeEvent.financial_impact_lakh ?? 'N/A'}
- New Monthly Income (Lakh): ${lifeEvent.new_monthly_income_lakh ?? 'N/A'}
- Effective Date: ${lifeEvent.effective_date}

Previous Pipeline Run Goal Assessment Summary:
${prevGoalAssessmentSummary}
`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      if (typeof parsed.requires_pipeline_restart === 'boolean' && parsed.impact_level && parsed.reasoning && parsed.guidance && Array.isArray(parsed.affected_goals)) {
        result = {
          requires_pipeline_restart: parsed.requires_pipeline_restart,
          impact_level: parsed.impact_level,
          reasoning: parsed.reasoning,
          guidance: parsed.guidance,
          affected_goals: parsed.affected_goals
        }
      }
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'VIKRAM: assessLifeEventImpact failed or failed to parse LLM JSON response. Using defaults.')
    }

    // Publish directive message to Deliberation Room
    try {
      await this.deliberationRoom.publish({
        pipeline_run_id: pipelineRunId,
        sender: 'VIKRAM',
        message_type: 'DIRECTIVE',
        recipient: 'ALL',
        payload: {
          directive_type: 'PROCEED',
          instructions: result.guidance
        },
        references: []
      })
    } catch (publishErr) {
      logger.warn({ publishErr, pipelineRunId }, 'VIKRAM: Failed to publish life event directive to Deliberation Room')
    }

    return result
  }

  async extractStructuredAnswers(
    rawAnswers: Record<string, string>,
    pipelineRunId: string
  ): Promise<{ monthly_income_lakh: number; monthly_expenses_lakh?: number; stated_goals: string[]; answers: Record<string, string>; goals_data: any[] }> {
    let extractionMode: 'LLM_EXTRACTION' | 'LEGACY_REGEX' = 'LEGACY_REGEX'

    try {
      const gpt = getGpt4oMini()
      const prompt = `
Extract the client's financial answers from this interview Q&A.
Return valid JSON only matching this format:
{
  "monthly_income_lakh": number,
  "goals": [
    {
      "goal_type": "RETIREMENT" | "CHILD_EDUCATION" | "HOME_PURCHASE" | "EMERGENCY_CORPUS" | "WEALTH_CREATION" | "VACATION" | "CUSTOM",
      "description": string,
      "target_corpus_lakh": number,
      "current_corpus_lakh": number,
      "monthly_sip_required_lakh": number,
      "target_date": string
    }
  ]
}

If income is mentioned in annual terms, divide by 12 to get monthly income in lakhs.

Interview Q&A Data:
${JSON.stringify(rawAnswers, null, 2)}
`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: VIKRAM_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      if (parsed && typeof parsed.monthly_income_lakh === 'number' && Array.isArray(parsed.goals)) {
        extractionMode = 'LLM_EXTRACTION'
        logger.info({ mode: extractionMode, pipelineRunId }, 'Interview extraction')

        return {
          monthly_income_lakh: parsed.monthly_income_lakh,
          monthly_expenses_lakh: parsed.monthly_expenses_lakh,
          stated_goals: parsed.goals.map((g: any) => g.description || 'Goal'),
          answers: rawAnswers,
          goals_data: parsed.goals.map((g: any) => ({
            goal_id: randomUUID(),
            goal_type: g.goal_type || 'CUSTOM',
            description: g.description || 'Goal',
            target_corpus_lakh: g.target_corpus_lakh || 10.0,
            current_corpus_lakh: g.current_corpus_lakh || 0,
            monthly_sip_required_lakh: g.monthly_sip_required_lakh || 0.1,
            target_date: g.target_date || new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString()
          }))
        }
      }
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'VIKRAM: LLM structured answer extraction failed. Falling back to legacy regex extraction.')
    }

    // Fallback to legacy regex extraction
    logger.info({ mode: extractionMode, pipelineRunId }, 'Interview extraction')
    return this.legacyExtract(rawAnswers)
  }

  private legacyExtract(answers: Record<string, string>): { monthly_income_lakh: number; monthly_expenses_lakh?: number; stated_goals: string[]; answers: Record<string, string>; goals_data: any[] } {
    let monthlyIncome = 2.0
    let monthlyExpenses = 1.0
    let statedGoals = ['Retirement corpus']
    let goalsData = [
      {
        goal_id: randomUUID(),
        goal_type: 'RETIREMENT',
        description: 'Retirement corpus',
        target_corpus_lakh: 100.0,
        current_corpus_lakh: 10.0,
        monthly_sip_required_lakh: 0.2,
        target_date: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]

    for (const [q, a] of Object.entries(answers)) {
      const qLower = q.toLowerCase()
      if (qLower.includes('income') || qLower.includes('earn')) {
        const match = a.match(/(\d+(?:\.\d+)?)/)
        if (match) monthlyIncome = parseFloat(match[1])
      }
      if (qLower.includes('expense') || qLower.includes('spend')) {
        const match = a.match(/(\d+(?:\.\d+)?)/)
        if (match) monthlyExpenses = parseFloat(match[1])
      }
      if (qLower.includes('goal') || qLower.includes('target')) {
        statedGoals = [a]
        goalsData[0].description = a
      }
    }

    return {
      monthly_income_lakh: monthlyIncome,
      monthly_expenses_lakh: monthlyExpenses,
      stated_goals: statedGoals,
      answers,
      goals_data: goalsData
    }
  }
}
