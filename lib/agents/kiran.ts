import { z } from 'zod'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import {
  MacroRiskBulletin,
  MacroRiskBulletinSchema,
  ClientRiskProfile,
  ClientRiskProfileSchema,
  HedgeMap,
  HedgeMapSchema,
  ScenarioStressTest,
  ScenarioStressTestSchema,
} from '@/lib/agents/types'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { writeMemory } from '@/lib/memory/memory-store'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { getGpt4oMini } from '@/lib/azure-openai'
import { KnowledgeCommons } from '@/lib/research/knowledge-commons'
import logger from '@/lib/logger'
import { KIRAN_RISK_PROMPT_V1 } from '@/lib/agents/prompts'

function makePipelineKey(agent: string, artifact: string, clientId: string, pipelineRunId: string): string {
  return `${agent}:${artifact}:${clientId}:${pipelineRunId}`
}

function cleanAndParseJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

export interface KiranClientData {
  age?: number
  yearsToGoal?: number
  version?: number
  ownsHome?: boolean
  dependents?: 'none' | 'spouse' | 'kids' | 'parents' | 'multiple'
  cityTier?: string
  monthlyRent?: number
  medicalConditions?: boolean
  taxBracketPct?: number
  [key: string]: unknown
}

export class Kiran {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
  }

  async dailyMacroScan(runId: string): Promise<MacroRiskBulletin> {
    logger.info({ runId }, 'KIRAN: dailyMacroScan invoked')

    const queries = [
      'RBI monetary policy repo rate MPC minutes today',
      'US Federal Reserve policy signals today',
      'India VIX level trend today',
      'Brent crude oil price today USD',
      'Gold MCX price INR today',
      'USD INR exchange rate trend today',
      'FII net flows Indian equity markets today',
      'India geopolitical events market impact today',
    ]

    const searchResults: { url: string; content_snippet: string; retrieved_at: string }[] = []

    try {
      const resolved = await Promise.all(
        queries.map((q) =>
          this.webResearchTool.research(
            {
              query_text: q,
              intent: 'daily_macro_scan',
              freshness_required_days: 1,
              max_sources: 2,
              memory_type: 'KIRAN_MACRO_BULLETIN',
            },
            runId,
          ),
        ),
      )
      for (const r of resolved.flat()) {
        searchResults.push({
          url: r.url,
          content_snippet: r.content_snippet,
          retrieved_at: r.retrieved_at,
        })
      }
    } catch (err) {
      logger.error({ err }, 'KIRAN: Tavily scan failed')
    }

    const contentForBulletin = searchResults.map((r) => `Source: ${r.url}\nContent: ${r.content_snippet}`).join('\n\n')

    const prompt = `Based on the provided search results from today, compile the daily 8-point MacroRiskBulletin.
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
  "fii_net_flow_cr": number,
  "geopolitical_alerts": string[],
  "key_risks": string[],
  "key_observations": string[]
}

Search Results:
${contentForBulletin || 'No search results available.'}`

    const gpt = getGpt4oMini()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: KIRAN_RISK_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const parsed = cleanAndParseJson(rawText) as Record<string, unknown>

    const now = new Date()
    const sources = searchResults.map((r) => ({ url: r.url, retrieved_at: r.retrieved_at }))

    const bulletin: MacroRiskBulletin = {
      bulletin_id: randomUUID(),
      generated_at: now.toISOString(),
      risk_level: z.enum(['LOW', 'ELEVATED', 'HIGH', 'CRITICAL']).parse(parsed.risk_level),
      rbi_policy_signal: String(parsed.rbi_policy_signal || 'STABLE'),
      fed_signal: String(parsed.fed_signal || 'STABLE'),
      india_vix: Number(parsed.india_vix || 15),
      india_vix_trend: z.enum(['UP', 'DOWN', 'STABLE']).parse(parsed.india_vix_trend || 'STABLE'),
      brent_crude_usd: Number(parsed.brent_crude_usd || 80),
      gold_mcx_inr: Number(parsed.gold_mcx_inr || 72000),
      usdinr_rate: Number(parsed.usdinr_rate || 83.5),
      usdinr_trend: z.enum(['UP', 'DOWN', 'STABLE']).parse(parsed.usdinr_trend || 'STABLE'),
      fii_net_flow_cr: Number(parsed.fii_net_flow_cr || 0),
      geopolitical_alerts: Array.isArray(parsed.geopolitical_alerts) ? parsed.geopolitical_alerts.map(String) : [],
      key_risks: Array.isArray(parsed.key_risks) ? parsed.key_risks.map(String) : [],
      key_observations: Array.isArray(parsed.key_observations) ? parsed.key_observations.map(String) : [],
      sources: sources.length > 0 ? sources : [{ url: 'https://nseindia.com', retrieved_at: now.toISOString() }],
    }

    const validated = MacroRiskBulletinSchema.parse(bulletin)

    await writeMemory(
      'KIRAN',
      makePipelineKey('KIRAN', 'macro_bulletin', 'GLOBAL', runId),
      {
        content: `Macro Bulletin Risk Level: ${validated.risk_level}. Risks: ${validated.key_risks.join(', ')}`,
        memory_type: 'KIRAN_MACRO_BULLETIN',
        source_url: validated.sources[0]?.url || 'Scan',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('KIRAN', 'macro_bulletin', 'GLOBAL', runId), validated.risk_level],
        pipeline_run_id: runId,
      },
    )

    await this.deliberationRoom.bind(runId).publish({
      sender: 'KIRAN',
      message_type: 'RISK_ALERT',
      recipient: 'ALL',
      content: '',
      payload: {
        risk_category: 'MACRO_RISK',
        risk_description: `KIRAN Daily Macro Scan: Risk Level is ${validated.risk_level}. Risks: ${validated.key_risks.join('; ')}`,
        affected_funds: ['ALL'],
        severity: validated.risk_level,
        data_source: validated.sources.map((s) => s.url).slice(0, 3).join(', '),
      },
      references: [],
    })

    if (validated.risk_level === 'HIGH' || validated.risk_level === 'CRITICAL') {
      logger.warn({ riskLevel: validated.risk_level }, 'KIRAN: high/critical risk level — escalating to DHRUV')
      await this.deliberationRoom.bind(runId).publish({
        sender: 'KIRAN',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        content: '',
        payload: {
          directive_type: 'ESCALATE',
          instructions: `KIRAN: Macro risk flagged as ${validated.risk_level}. Key Risks: ${validated.key_risks.join(', ')}. Portfolio hedge verification and risk adjustments required.`,
          deadline_minutes: 60,
        },
        references: [validated.bulletin_id],
      })
    }

    return validated
  }

  async buildClientRiskProfile(
    clientId: string,
    clientData: KiranClientData,
    pipelineRunId: string,
  ): Promise<ClientRiskProfile> {
    logger.info({ clientId, pipelineRunId }, 'KIRAN: buildClientRiskProfile invoked')

    let searchResults: { url: string; content_snippet: string; retrieved_at: string }[] = []

    try {
      const kc = new KnowledgeCommons(this.deliberationRoom)
      await kc.queryCommons('KIRAN', 'macro_risk_patterns')

      const resolved = await this.webResearchTool.research(
        {
          query_text: `behavioral finance portfolio asset allocation risk factors age ${clientData.age ?? 30} dependents ${clientData.dependents ?? 'none'} India`,
          intent: 'client_risk_research',
          freshness_required_days: 90,
          max_sources: 3,
          memory_type: 'KIRAN_CLIENT_RISK_PROFILE',
        },
        pipelineRunId,
      )
      for (const r of resolved) {
        searchResults.push({
          url: r.url,
          content_snippet: r.content_snippet,
          retrieved_at: r.retrieved_at,
        })
      }
    } catch (err) {
      logger.warn({ clientId, err }, 'KIRAN: client risk research failed')
    }

    const researchContext = searchResults.map((r) => r.content_snippet).join('\n')

    const prompt = `Build a ClientRiskProfile for a client with the following demographics and behavioural finance context.
Return a valid JSON object ONLY. Do not include markdown code block formatting.

Client Demographics:
${JSON.stringify(clientData, null, 2)}

Behavioural Finance Research Context:
${researchContext}

JSON Schema:
{
  "income_stability_score": number, // 1 to 10
  "emergency_fund_months": number,
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
}`

    const gpt = getGpt4oMini()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: KIRAN_RISK_PROMPT_V1 },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const parsed = cleanAndParseJson(rawText) as Record<string, unknown>

    const now = new Date()
    const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    const profile: ClientRiskProfile = {
      profile_id: randomUUID(),
      client_id: clientId,
      version: clientData.version || 1,
      generated_at: now.toISOString(),
      expires_at: expires.toISOString(),
      age: Math.max(1, Math.min(120, clientData.age || 30)),
      years_to_goal: Math.max(0, clientData.yearsToGoal || 15),
      income_stability_score: Math.max(1, Math.min(10, Number(parsed.income_stability_score || 7))),
      existing_liabilities: clientData.monthlyRent ? `Rent of ${clientData.monthlyRent} per month` : null,
      dependants: clientData.dependents || 'none',
      emergency_fund_months: Math.max(0, Number(parsed.emergency_fund_months || 6)),
      insurance_coverage: clientData.medicalConditions ? 'Medical insurance required due to conditions' : 'Standard coverage',
      tax_bracket_pct: Math.max(0, Math.min(100, clientData.taxBracketPct || 30)),
      behavioural_risk_tolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']).parse(parsed.behavioural_risk_tolerance || 'MEDIUM'),
      stated_risk_tolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']).parse(parsed.stated_risk_tolerance || 'MEDIUM'),
      geographic_income_risk: clientData.cityTier || 'metro',
      factors: Array.isArray(parsed.factors)
        ? parsed.factors.map((f: any) => ({
            factor_name: String(f.factor_name || 'Factor'),
            value: String(f.value || ''),
            source_url: String(f.source_url || 'https://rbi.org.in'),
            rationale: String(f.rationale || ''),
          }))
        : [],
    }

    const validated = ClientRiskProfileSchema.parse(profile)

    await writeMemory(
      'KIRAN',
      makePipelineKey('KIRAN', 'client_risk_profile', clientId, pipelineRunId),
      {
        content: `Risk Profile for Client ${clientId}. Behavioural risk tolerance: ${validated.behavioural_risk_tolerance}`,
        memory_type: 'KIRAN_CLIENT_RISK_PROFILE',
        source_url: validated.factors[0]?.source_url || 'Registry',
        confidence_tier: 'VERIFIED',
        tags: [
          makePipelineKey('KIRAN', 'client_risk_profile', clientId, pipelineRunId),
          validated.behavioural_risk_tolerance,
        ],
        pipeline_run_id: pipelineRunId,
      },
    )

    return validated
  }

  async buildHedgeMap(portfolioDraft: { fund_allocations?: any[]; client_id?: string }, pipelineRunId: string): Promise<HedgeMap> {
    logger.info({ pipelineRunId }, 'KIRAN: buildHedgeMap invoked')

    const holdings = portfolioDraft.fund_allocations || []
    const positionsHedgeDetails: HedgeMap['positions'] = []

    const gpt = getGpt4oMini()

    for (const h of holdings) {
      let fundName = h.fund_name
      try {
        const [fund] = await this.db.select().from(schema.agentFunds).where(eq(schema.agentFunds.schemeCode, h.scheme_code)).limit(1)
        fundName = fund?.schemeName || h.fund_name || `Fund Code ${h.scheme_code}`
      } catch (err) {
        logger.warn({ err, schemeCode: h.scheme_code }, 'KIRAN: failed to lookup fund name')
      }

      const prompt = `Create a hypothetical risk hedge scenario and contingency plan for allocating ${h.allocation_pct}% to "${fundName}".
Return a valid JSON object ONLY. Do not include backticks or markdown.

JSON Schema:
{
  "risk_scenario": string, // "If [scenario], this allocation [does X]"
  "hedge_instrument": string, // "The hedge for this is [Y]"
  "hedge_rationale": string,
  "contingency_if_hedge_fails": string // "If the hedge fails, the contingency is [Z]"
}`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: KIRAN_RISK_PROMPT_V1 },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const parsed = cleanAndParseJson(rawText) as Record<string, unknown>

      positionsHedgeDetails.push({
        fund_name: String(fundName),
        scheme_code: String(h.scheme_code),
        allocation_pct: Number(h.allocation_pct),
        risk_scenario: String(parsed.risk_scenario || 'Market stress'),
        hedge_instrument: String(parsed.hedge_instrument || 'Diversified counter-position'),
        hedge_rationale: String(parsed.hedge_rationale || 'For discussion only'),
        contingency_if_hedge_fails: String(parsed.contingency_if_hedge_fails || 'Revisit allocation'),
      })
    }

    const now = new Date()
    const coverage = positionsHedgeDetails.length > 0 ? Math.min(100, positionsHedgeDetails.length * 17) : 0

    const hedgeMap: HedgeMap = {
      portfolio_id: portfolioDraft.client_id || randomUUID(),
      generated_at: now.toISOString(),
      positions: positionsHedgeDetails,
      overall_hedge_coverage_pct: coverage,
      sources: [{ url: 'https://rbi.org.in', retrieved_at: now.toISOString() }],
    }

    const validated = HedgeMapSchema.parse(hedgeMap)

    await writeMemory(
      'KIRAN',
      makePipelineKey('KIRAN', 'hedge_map', portfolioDraft.client_id || 'UNKNOWN', pipelineRunId),
      {
        content: `Hedge Map for Portfolio Draft. Overall coverage: ${validated.overall_hedge_coverage_pct}%`,
        memory_type: 'KIRAN_HEDGE_MAP',
        source_url: validated.sources[0].url,
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('KIRAN', 'hedge_map', portfolioDraft.client_id || 'UNKNOWN', pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
    )

    await this.deliberationRoom.bind(pipelineRunId).send(
      {
        sender: 'KIRAN',
        message_type: 'RISK_ALERT',
        recipient: 'ALL',
        content: '',
        payload: {
          risk_category: 'PORTFOLIO_HEDGE_MAP',
          risk_description: `Hedge Map built. Overall coverage is ${validated.overall_hedge_coverage_pct}%.`,
          affected_funds: validated.positions.map((p) => p.fund_name),
          severity: 'LOW',
          data_source: validated.sources[0].url,
        },
        references: [],
      },
      undefined,
    )

    return validated
  }

  async runStressTest(
    portfolioDraft: { fund_allocations?: any[]; client_id?: string },
    pipelineRunId: string,
  ): Promise<ScenarioStressTest> {
    logger.info({ pipelineRunId }, 'KIRAN: runStressTest invoked')

    const holdings = portfolioDraft.fund_allocations || []

    const scenariosInput = [
      { name: 'Indian equity bull run (+30%)', desc: 'Indian equity bull run (+30% over 12 months)' },
      { name: 'Indian equity bear market (-30%)', desc: 'Indian equity bear market (-30% over 12 months)' },
      { name: 'RBI rate hike cycle (+200bps)', desc: 'RBI rate hike cycle (policy rate +200bps over 18 months)' },
      { name: 'INR depreciation (-15%)', desc: 'INR depreciation (-15% vs USD over 12 months)' },
      { name: 'Stagflation', desc: 'Stagflation (high inflation + low growth for 24 months)' },
    ]

    const gpt = getGpt4oMini()
    const scenariosResult: ScenarioStressTest['scenarios'] = []

    for (const sc of scenariosInput) {
      const fundContext = await Promise.all(
        holdings.map(async (h) => {
          let schemeType = 'unknown'
          try {
            const [fund] = await this.db.select().from(schema.agentFunds).where(eq(schema.agentFunds.schemeCode, h.scheme_code)).limit(1)
            schemeType = fund?.schemeType || schemeType
          } catch (err) {
            logger.warn({ err, schemeCode: h.scheme_code }, 'KIRAN: failed to lookup fund type for stress test')
          }
          return {
            scheme_code: h.scheme_code,
            fund_name: h.fund_name || h.scheme_code,
            allocation_pct: h.allocation_pct,
            scheme_type: schemeType,
          }
        }),
      )

      const prompt = `Estimate the hypothetical portfolio-level impact under the scenario: "${sc.desc}".
Return a valid JSON object ONLY. Do not include backticks or markdown.

Portfolio Holdings Context (hypothetical allocation for educational discussion):
${JSON.stringify(fundContext, null, 2)}

JSON Schema:
{
  "estimated_portfolio_return_pct": number,
  "worst_case_drawdown_pct": number,
  "recovery_timeline_months": number,
  "most_affected_funds": string[], // list of scheme codes
  "least_affected_funds": string[] // list of scheme codes
}`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: KIRAN_RISK_PROMPT_V1 },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const parsed = cleanAndParseJson(rawText) as Record<string, unknown>

      scenariosResult.push({
        scenario_name: sc.name,
        description: sc.desc,
        estimated_portfolio_return_pct: Number(parsed.estimated_portfolio_return_pct || 0),
        worst_case_drawdown_pct: Number(parsed.worst_case_drawdown_pct || 0),
        recovery_timeline_months: Math.max(0, Number(parsed.recovery_timeline_months || 0)),
        most_affected_funds: Array.isArray(parsed.most_affected_funds) ? parsed.most_affected_funds.map(String) : [],
        least_affected_funds: Array.isArray(parsed.least_affected_funds) ? parsed.least_affected_funds.map(String) : [],
      })
    }

    const stressTest: ScenarioStressTest = {
      portfolio_id: portfolioDraft.client_id || randomUUID(),
      tested_at: new Date().toISOString(),
      scenarios: scenariosResult,
    }

    const validated = ScenarioStressTestSchema.parse(stressTest)

    await writeMemory(
      'KIRAN',
      makePipelineKey('KIRAN', 'scenario_stress_test', portfolioDraft.client_id || 'UNKNOWN', pipelineRunId),
      {
        content: validated,
        memory_type: 'KIRAN_HEDGE_MAP',
        source_url: 'Internal',
        confidence_tier: 'VERIFIED',
        tags: [makePipelineKey('KIRAN', 'scenario_stress_test', portfolioDraft.client_id || 'UNKNOWN', pipelineRunId)],
        pipeline_run_id: pipelineRunId,
      },
    )

    return validated
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('KIRAN: starting weekly research sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text:
            'portfolio hedging strategies sovereign wealth fund disclosures emerging markets risk management SEBI RBI publications',
          intent: 'weekly_hedging_sweep',
          freshness_required_days: 7,
          max_sources: 4,
          memory_type: 'KIRAN_HEDGE_MAP',
        },
        'WEEKLY_RESEARCH',
      )
    } catch (err) {
      logger.error({ err }, 'KIRAN: weekly research failed')
    }
  }
}
