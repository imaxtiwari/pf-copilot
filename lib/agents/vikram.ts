import { randomUUID } from 'crypto'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  DecomposedGoal,
  ClientGoalAssessment,
  ClientGoalAssessmentSchema,
  StrategyFramework,
  StrategyFrameworkSchema,
} from './types/vikram-types'
import { ClientRiskProfile } from './types/kiran-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4oMini } from '../azure-openai'
import logger from '../logger'

const VIKRAM_SYSTEM_PROMPT = `You are VIKRAM (Visionary Intelligence for Kinetic Return & Asset Management), the Market Strategist in a multi-agent portfolio intelligence system for Indian investors.

YOUR ROLE: Deeply understand how markets work at every level. Interview the client to understand their goals. Then reason thoroughly about whether those goals are actually achievable. If not, produce a revised, achievable plan. Go online to continuously learn every strategy and framework ever written on how to approach fund selection and long-term financial planning.

YOUR GOAL ASSESSMENT PROTOCOL (mandatory, sequential):
Step 1 — Client Interview: Ask the client a structured set of questions (minimum 15, maximum 25 questions). These must be contextualised based on the client's age, income tier, and life stage from KIRAN's ClientRiskProfile. Never ask duplicate questions or questions whose answers are already in the risk profile.
Step 2 — Goal Decomposition: Break every stated goal into: goal type, target corpus, target date, current corpus, required monthly SIP equivalent, required CAGR assumption, inflation-adjusted target.
Step 3 — Achievability Assessment: Run a structured test checking if required CAGR is realistic, if monthly SIP is realistic given income, if goal sequence has conflicts, and if there are structural contradictions.
Step 4 — Revised Plan: If goals are not achievable, produce a revised goal set with explicit reasoning.
Step 5 — Strategy Framework Selection: Select the most appropriate frameworks (core-satellite, bucket strategy, liability-matching, barbell, etc.) for this client. Cite sources and explain why they apply.

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
    clientRiskProfile: ClientRiskProfile,
    pipelineRunId: string
  ): Promise<string[]> {
    logger.info({ clientId: clientRiskProfile.client_id, pipelineRunId }, 'VIKRAM: conductClientInterview invoked')

    const gpt = getGpt4oMini()
    const prompt = `
Generate a list of 15 to 25 client interview questions to assess their specific investment goals.
These questions must be highly contextualized based on the client's risk profile details.
You MUST NOT ask questions about information already present in the client's risk profile (such as age, dependents, liabilities, behavioural risk tolerance).
Return a valid JSON array of strings ONLY. Do not include markdown code block formatting or backticks.

Client Risk Profile Details:
${JSON.stringify(clientRiskProfile, null, 2)}
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
    clientAnswers: { stated_goals: string[]; monthly_income_lakh: number; answers: Record<string, string>; goals_data: any[] },
    clientRiskProfile: ClientRiskProfile,
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

    // Check monthly SIP income ratio
    const statedIncome = clientAnswers.monthly_income_lakh || 2.0
    const sipRatio = statedIncome > 0 ? totalSipRequired / statedIncome : 0
    if (sipRatio > 1.0) {
      achievabilityVerdict = 'IMPOSSIBLE'
      conflicts.push(`Total required SIP (${totalSipRequired.toFixed(2)}L) exceeds 100% of stated income (${statedIncome.toFixed(2)}L)`)
    } else if (sipRatio > 0.6) {
      if (achievabilityVerdict !== 'IMPOSSIBLE') {
        achievabilityVerdict = 'REVISED'
      }
      conflicts.push(`Total required SIP (${totalSipRequired.toFixed(2)}L) exceeds 60% of stated income (${statedIncome.toFixed(2)}L)`)
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
      client_id: clientRiskProfile.client_id,
      version: clientRiskProfile.version,
      assessed_at: assessedAt,
      expires_at: expiresAt,
      stated_goals: clientAnswers.stated_goals,
      decomposed_goals: decomposedGoals,
      achievability_verdict: achievabilityVerdict,
      revised_plan: revisedPlan,
      goal_sequence_conflicts: conflicts,
      sources: [{ url: 'https://sebi.gov.in', retrieved_at: assessedAt }],
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

    return validated
  }

  async selectStrategyFramework(
    assessment: ClientGoalAssessment,
    riskProfile: ClientRiskProfile,
    pipelineRunId: string
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
    const prompt = `
Select the most appropriate investment strategy frameworks (core-satellite, bucket strategy, goal-based, liability-matching) for the client.
You must return a valid JSON object ONLY. Do not include markdown.

Client Risk Profile:
${JSON.stringify(riskProfile, null, 2)}

Goal Assessment:
${JSON.stringify(assessment, null, 2)}

Research Context:
${researchContext}

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
}
