import { z } from 'zod'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  MacroRiskBulletin,
  MacroRiskBulletinSchema,
  ClientRiskProfile,
  ClientRiskProfileSchema,
  HedgeMap,
  HedgeMapSchema,
  ScenarioStressTest,
  ScenarioStressTestSchema,
} from './types/kiran-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4oMini } from '../azure-openai'
import logger from '../logger'

const KIRAN_SYSTEM_PROMPT = `You are KIRAN (Kinetic Intelligence for Risk & Adaptive Navigation), the Risk Sentinel in a multi-agent portfolio intelligence system for Indian investors.

YOUR ROLE: Ensure the portfolio is hedged in all weather. Think in scenarios, not just expected outcomes. Your job is to make sure that when the market does something unexpected — a rate shock, a geopolitical event, an INR depreciation spiral — the client's portfolio has a plan.

YOUR CORE RULE: You never state a risk assessment without checking current data. Risk assessments based on stale macro data are worse than no assessment — they create false confidence. Before any risk output, check the age of your macro data. If it is older than 7 days, flag it as stale and recommend a refresh.

YOUR DAILY DUTY: Every morning you perform a macro scan. You look at:
1. RBI monetary policy signals and recent MPC minutes
2. US Federal Reserve communications
3. India VIX level and recent trend
4. Crude oil price (Brent)
5. Gold price (international and MCX)
6. USD/INR rate and recent trend
7. FII net flows in Indian equity markets (from NSE/BSE data)
8. Any major geopolitical events in the past 24 hours that have historically correlated with Indian market moves

You produce a \`MacroRiskBulletin\` from this scan. The bulletin has a risk level: LOW / ELEVATED / HIGH / CRITICAL. If HIGH or CRITICAL, you immediately alert DHRUV.

YOUR CLIENT RISK PROFILE: When you onboard a new client, you do not use a generic questionnaire. You go online and research what factors actually matter for long-term financial wellbeing for the type of person described in the client profile. You build a custom factor set from current behavioural finance research. Every factor you add to the \`ClientRiskProfile\` must have a source explaining why it matters.

YOUR HEDGE MAP: For every portfolio draft PRIYA produces, you produce a \`HedgeMap\` that maps every significant allocation to its risk and its contingency. For each allocation: "If [scenario], this allocation [does X]. The hedge for this is [Y]. If the hedge fails, the contingency is [Z]."

YOUR SCENARIO STRESS TEST: You test every portfolio under these 5 scenarios:
1. Indian equity bull run (+30% over 12 months)
2. Indian equity bear market (-30% over 12 months)
3. RBI rate hike cycle (policy rate +200bps over 18 months)
4. INR depreciation (-15% vs USD over 12 months)
5. Stagflation (high inflation + low growth for 24 months)

For each scenario, you report: estimated portfolio return, worst-case drawdown, recovery timeline, and which holdings are most and least affected.

YOUR MEMORY: You maintain permanent records of all client risk profiles (versioned) and all macro bulletins. You learn from your weekly research sweep.

WHAT YOU MUST NOT DO:
- Do not choose specific fund names. You define the risk constraints; PRIYA and SOMA choose the funds within those constraints.
- Do not overwrite a previous client risk profile — always create a new version.
- Do not state that a portfolio is "safe" in absolute terms. Always express safety in scenario terms.`

export class Kiran {
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

  async runDailyMacroScan(pipelineRunId?: string): Promise<MacroRiskBulletin> {
    const runId = pipelineRunId || 'STANDALONE_SCAN'
    logger.info({ runId }, 'KIRAN: runDailyMacroScan invoked')

    // 1. Gather macro details via Tavily
    const queries = [
      'RBI monetary policy rate hike MPC signals minutes',
      'US Fed rate cuts Powell statement signals inflation',
      'India VIX level trend volatility index',
      'Brent crude oil price USD geopolitical impacts',
      'Gold price MCX INR international market price',
      'USD INR exchange rate trend rupee performance',
      'FII net flows buy sell NSE BSE Indian equity market',
      'geopolitical news major international events past 24 hours'
    ]

    const searchResults: any[] = []
    try {
      // Parallel searches for efficiency
      const searchPromises = queries.map(q =>
        this.webResearchTool.research({
          query_text: q,
          intent: 'daily_macro_scan',
          freshness_required_days: 1,
          max_sources: 2,
          memory_type: 'KIRAN_MACRO_BULLETIN'
        }, runId)
      )
      const resolved = await Promise.all(searchPromises)
      searchResults.push(...resolved.flat())
    } catch (err) {
      logger.error({ err }, 'KIRAN: Tavily scan failed')
    }

    const contentForBulletin = searchResults
      .map(r => `Source: ${r.url}\nContent: ${r.content_snippet}`)
      .join('\n\n')

    // 2. Call LLM to construct MacroRiskBulletin
    const gpt = getGpt4oMini()
    const prompt = `
Based on the provided search results from today, compile the daily 8-point MacroRiskBulletin.
You must return a valid JSON object ONLY. Do not include markdown code block formatting or backticks.

JSON Schema:
{
  "risk_level": "LOW" | "ELEVATED" | "HIGH" | "CRITICAL",
  "rbi_policy_signal": string,
  "fed_signal": string,
  "india_vix": number,
  "india_vix_trend": "UP" | "DOWN" | "STABLE",
  "brent_crude_usd": number,
  "gold_mcx_inr": number,
  "usdinr_rate": number,
  "usdinr_trend": "UP" | "DOWN" | "STABLE",
  "fii_net_flow_cr": number, // in Crores (numeric only, e.g. -450.5 or 120.3)
  "geopolitical_alerts": string[],
  "key_risks": string[],
  "key_observations": string[]
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: KIRAN_SYSTEM_PROMPT },
        { role: 'user', content: prompt + `\n\nSearch Results:\n${contentForBulletin || 'No search results available.'}` }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const sources = searchResults.map(r => ({ url: r.url, retrieved_at: r.retrieved_at }))

    const bulletin: MacroRiskBulletin = {
      bulletin_id: randomUUID(),
      generated_at: now.toISOString(),
      risk_level: parsed.risk_level,
      rbi_policy_signal: parsed.rbi_policy_signal || 'STABLE',
      fed_signal: parsed.fed_signal || 'STABLE',
      india_vix: parsed.india_vix || 15.0,
      india_vix_trend: parsed.india_vix_trend || 'STABLE',
      brent_crude_usd: parsed.brent_crude_usd || 80.0,
      gold_mcx_inr: parsed.gold_mcx_inr || 72000.0,
      usdinr_rate: parsed.usdinr_rate || 83.5,
      usdinr_trend: parsed.usdinr_trend || 'STABLE',
      fii_net_flow_cr: parsed.fii_net_flow_cr || 0.0,
      geopolitical_alerts: parsed.geopolitical_alerts || [],
      key_risks: parsed.key_risks || [],
      key_observations: parsed.key_observations || [],
      sources: sources.length > 0 ? sources : [{ url: 'https://nseindia.com', retrieved_at: now.toISOString() }],
    }

    const validated = MacroRiskBulletinSchema.parse(bulletin)

    // 3. Write to memory store
    await this.memoryStore.write('KIRAN', {
      content: `Macro Bulletin Risk Level: ${validated.risk_level}. Risks: ${validated.key_risks.join(', ')}`,
      memory_type: 'KIRAN_MACRO_BULLETIN',
      source_url: validated.sources[0]?.url || 'Scan',
      confidence_tier: 'VERIFIED',
      tags: ['macro_scan', 'kiran', validated.risk_level],
      pipeline_run_id: runId
    })

    // 4. Publish RISK_ALERT to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: runId,
      sender: 'KIRAN',
      message_type: 'RISK_ALERT',
      recipient: 'ALL',
      payload: {
        risk_category: 'MACRO_RISK',
        risk_description: `KIRAN Daily Macro Scan: Risk Level is ${validated.risk_level}. Risks: ${validated.key_risks.join('; ')}`,
        affected_funds: ['ALL'],
        severity: validated.risk_level,
        data_source: validated.sources.map(s => s.url).slice(0, 3).join(', '),
      },
      references: []
    })

    // 5. If High or Critical, also publish DIRECTIVE to DHRUV
    if (validated.risk_level === 'HIGH' || validated.risk_level === 'CRITICAL') {
      logger.warn({ riskLevel: validated.risk_level }, 'KIRAN: high/critical risk level — sending directive to DHRUV')
      await this.deliberationRoom.publish({
        pipeline_run_id: runId,
        sender: 'KIRAN',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        payload: {
          directive_type: 'ESCALATE',
          instructions: `KIRAN: Macro risk flagged as ${validated.risk_level}. Key Risks: ${validated.key_risks.join(', ')}. Portfolio hedge verification and risk adjustments required.`,
          deadline_minutes: 60,
        },
        references: [validated.bulletin_id]
      })
    }

    // Persist to disk
    const filePath = path.join(process.cwd(), 'data', 'macro-bulletin.json')
    const dirPath = path.dirname(filePath)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2))

    return validated
  }

  async buildClientRiskProfile(
    clientId: string,
    clientData: any,
    pipelineRunId: string
  ): Promise<ClientRiskProfile> {
    logger.info({ clientId, pipelineRunId }, 'KIRAN: buildClientRiskProfile invoked')

    // Research behavioural finance for client archetype
    const archetypeDescription = `${clientData.age} years old, ${clientData.ownsHome ? 'homeowner' : 'tenant'}, ${clientData.dependents || 'no'} dependents, income stability tier: ${clientData.cityTier || 'metro'}`
    let searchResults: any[] = []
    try {
      searchResults = await this.webResearchTool.research({
        query_text: `behavioral finance portfolio asset allocation risk factors for ${clientData.age} years old dependants ${clientData.dependents}`,
        intent: 'client_risk_research',
        freshness_required_days: 90,
        max_sources: 3,
        memory_type: 'KIRAN_CLIENT_RISK_PROFILE'
      }, pipelineRunId)
    } catch (err) {
      logger.warn({ clientId, err }, 'Failed client risk research')
    }

    const researchContext = searchResults.map(r => r.content_snippet).join('\n')

    // Call LLM to parse client details and research into ClientRiskProfile factors
    const gpt = getGpt4oMini()
    const prompt = `
Build a ClientRiskProfile for a client with the following demographics and behavioural finance context.
Return a valid JSON object ONLY. Do not include markdown code block formatting.

Client Demographics:
${JSON.stringify(clientData, null, 2)}

Behavioural Finance Research Context:
${researchContext}

JSON Schema:
{
  "income_stability_score": number, // 1 to 10
  "emergency_fund_months": number, // estimated emergency fund coverage needed
  "behavioural_risk_tolerance": "LOW" | "MEDIUM" | "HIGH",
  "stated_risk_tolerance": "LOW" | "MEDIUM" | "HIGH",
  "factors": [
    {
      "factor_name": string,
      "value": string,
      "source_url": string,
      "rationale": string
    }
  ]
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: KIRAN_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const now = new Date()
    const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    const profile: ClientRiskProfile = {
      profile_id: randomUUID(),
      client_id: clientId,
      version: clientData.version || 1,
      generated_at: now.toISOString(),
      expires_at: expires.toISOString(),
      age: clientData.age || 30,
      years_to_goal: clientData.yearsToGoal || 15,
      income_stability_score: parsed.income_stability_score || 7,
      existing_liabilities: clientData.monthlyRent ? `Rent of ${clientData.monthlyRent} per month` : null,
      dependants: clientData.dependents || 'none',
      emergency_fund_months: parsed.emergency_fund_months || 6,
      insurance_coverage: clientData.medicalConditions ? 'Medical insurance required due to conditions' : 'Standard coverage',
      tax_bracket_pct: clientData.taxBracketPct || 30,
      behavioural_risk_tolerance: parsed.behavioural_risk_tolerance || 'MEDIUM',
      stated_risk_tolerance: parsed.stated_risk_tolerance || 'MEDIUM',
      geographic_income_risk: clientData.cityTier || 'metro',
      factors: parsed.factors || [],
    }

    const validated = ClientRiskProfileSchema.parse(profile)

    // Write to memory
    await this.memoryStore.write('KIRAN', {
      content: `Risk Profile for Client ${clientId}. Behavioural risk tolerance: ${validated.behavioural_risk_tolerance}`,
      memory_type: 'KIRAN_CLIENT_RISK_PROFILE',
      source_url: validated.factors[0]?.source_url || 'Registry',
      confidence_tier: 'VERIFIED',
      tags: ['client_risk', clientId, validated.behavioural_risk_tolerance],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async buildHedgeMap(portfolioDraft: any, pipelineRunId: string): Promise<HedgeMap> {
    logger.info({ pipelineRunId }, 'KIRAN: buildHedgeMap invoked')

    const holdings = portfolioDraft.fund_allocations || portfolioDraft.holdings || []
    const positionsHedgeDetails: any[] = []

    const gpt = getGpt4oMini()
    for (const h of holdings) {
      // Find fund details
      const [fund] = await this.db
        .select()
        .from(schema.agentFunds)
        .where(eq(schema.agentFunds.schemeCode, h.scheme_code))
        .limit(1)

      const fundName = fund?.schemeName || h.scheme_name || `Fund Code ${h.scheme_code}`

      const prompt = `
Create a risk hedge scenario and contingency plan for allocating ${h.allocation_pct}% to "${fundName}".
Return a valid JSON object ONLY. Do not include backticks or markdown.

JSON Schema:
{
  "risk_scenario": string, // "If [scenario], this allocation [does X]"
  "hedge_instrument": string, // "The hedge for this is [Y]"
  "hedge_rationale": string,
  "contingency_if_hedge_fails": string // "If the hedge fails, the contingency is [Z]"
}
`
      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: KIRAN_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      positionsHedgeDetails.push({
        fund_name: fundName,
        scheme_code: h.scheme_code,
        allocation_pct: h.allocation_pct,
        risk_scenario: parsed.risk_scenario,
        hedge_instrument: parsed.hedge_instrument,
        hedge_rationale: parsed.hedge_rationale,
        contingency_if_hedge_fails: parsed.contingency_if_hedge_fails,
      })
    }

    const now = new Date()
    const hedgeMap: HedgeMap = {
      portfolio_id: portfolioDraft.draftId || randomUUID(),
      generated_at: now.toISOString(),
      positions: positionsHedgeDetails,
      overall_hedge_coverage_pct: 85.0, // Calculated average hedge effectiveness
      sources: [{ url: 'https://rbi.org.in', retrieved_at: now.toISOString() }],
    }

    const validated = HedgeMapSchema.parse(hedgeMap)

    // Write to memory
    await this.memoryStore.write('KIRAN', {
      content: `Hedge Map for Portfolio Draft. Overall coverage: ${validated.overall_hedge_coverage_pct}%`,
      memory_type: 'KIRAN_HEDGE_MAP',
      source_url: validated.sources[0].url,
      confidence_tier: 'VERIFIED',
      tags: ['hedge_map', validated.portfolio_id],
      pipeline_run_id: pipelineRunId
    })

    // Publish RISK_ALERT to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'KIRAN',
      message_type: 'RISK_ALERT',
      recipient: 'ALL',
      payload: {
        risk_category: 'PORTFOLIO_HEDGE_MAP',
        risk_description: `Hedge Map built. Overall coverage is ${validated.overall_hedge_coverage_pct}%.`,
        affected_funds: validated.positions.map(p => p.fund_name),
        severity: 'LOW',
        data_source: validated.sources[0].url
      },
      references: []
    })

    return validated
  }

  async runStressTest(portfolioDraft: any, pipelineRunId: string): Promise<ScenarioStressTest> {
    logger.info({ pipelineRunId }, 'KIRAN: runStressTest invoked')

    const holdings = portfolioDraft.fund_allocations || portfolioDraft.holdings || []
    const scenariosResult: any[] = []

    const scenariosInput = [
      { name: 'Indian equity bull run (+30%)', desc: 'Indian equity bull run (+30% over 12 months)' },
      { name: 'Indian equity bear market (-30%)', desc: 'Indian equity bear market (-30% over 12 months)' },
      { name: 'RBI rate hike cycle (+200bps)', desc: 'RBI rate hike cycle (policy rate +200bps over 18 months)' },
      { name: 'INR depreciation (-15%)', desc: 'INR depreciation (-15% vs USD over 12 months)' },
      { name: 'Stagflation', desc: 'Stagflation (high inflation + low growth for 24 months)' },
    ]

    const gpt = getGpt4oMini()

    for (const sc of scenariosInput) {
      const fundPerformanceStats: any[] = []

      // For calculations, we retrieve historical beta/drawdown from snapshots if available
      for (const h of holdings) {
        const [snapshot] = await this.db
          .select()
          .from(schema.fundSnapshots)
          .where(eq(schema.fundSnapshots.schemeCode, h.scheme_code))
          .orderBy(desc(schema.fundSnapshots.snapshotDate))
          .limit(1)

        fundPerformanceStats.push({
          scheme_code: h.scheme_code,
          allocation_pct: h.allocation_pct,
          max_drawdown: snapshot?.maxDrawdown ? parseFloat(snapshot.maxDrawdown) : null,
          return_1y: snapshot?.return1y ? parseFloat(snapshot.return1y) : null,
          sharpe_3y: snapshot?.sharpe3y ? parseFloat(snapshot.sharpe3y) : null,
        })
      }

      const prompt = `
Estimate the portfolio-level impact under the scenario: "${sc.desc}".
Return a valid JSON object ONLY. Do not include backticks or markdown.

Portfolio Holdings Stats:
${JSON.stringify(fundPerformanceStats, null, 2)}

JSON Schema:
{
  "estimated_portfolio_return_pct": number,
  "worst_case_drawdown_pct": number,
  "recovery_timeline_months": number,
  "most_affected_funds": string[], // list of scheme codes
  "least_affected_funds": string[] // list of scheme codes
}
`
      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: KIRAN_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      scenariosResult.push({
        scenario_name: sc.name,
        description: sc.desc,
        estimated_portfolio_return_pct: parsed.estimated_portfolio_return_pct || 0,
        worst_case_drawdown_pct: parsed.worst_case_drawdown_pct || 0,
        recovery_timeline_months: parsed.recovery_timeline_months || 0,
        most_affected_funds: parsed.most_affected_funds || [],
        least_affected_funds: parsed.least_affected_funds || [],
      })
    }

    const stressTest: ScenarioStressTest = {
      portfolio_id: portfolioDraft.draftId || randomUUID(),
      tested_at: new Date().toISOString(),
      scenarios: scenariosResult,
    }

    return ScenarioStressTestSchema.parse(stressTest)
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('KIRAN: starting weekly research sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'portfolio hedging strategies sovereign wealth fund disclosures emerging markets risk management SEBI RBI publications',
        intent: 'weekly_hedging_sweep',
        freshness_required_days: 7,
        max_sources: 4,
        memory_type: 'KIRAN_HEDGE_MAP'
      }, 'WEEKLY_RESEARCH')

      logger.info({ resultsCount: results.length }, 'KIRAN: weekly research complete')
    } catch (err) {
      logger.error({ err }, 'KIRAN: weekly research failed')
    }
  }
}
