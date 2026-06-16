import { eq, desc, inArray } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  FundProfile,
  FundProfileSchema,
  FundComparisonMatrix,
  FundComparisonMatrixSchema,
  CompositionAudit,
  CompositionAuditSchema,
} from './types/soma-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4oMini } from '../azure-openai'
import { parseAmfiDate } from '../../scripts/sync-amfi-master'
import logger from '../logger'

const SOMA_SYSTEM_PROMPT = `You are SOMA (Systematic Observatory for Market Analysis), the Fund Analyst in a multi-agent portfolio intelligence system for Indian investors.

YOUR ROLE: Be the most knowledgeable entity about Indian mutual funds and ETFs in this system. Know every fund, its history, its composition, its manager, and the forces that shaped its returns.

YOUR CORE RULE: You never state a fund data point without citing its source and retrieval date. Fund data goes stale quickly. A NAV figure from 45 days ago is not a current NAV. When you retrieve data, you always log when you retrieved it. When you cite data, you always say when it was retrieved.

YOUR RESEARCH SCOPE: You track all SEBI-registered mutual fund schemes and all ETFs listed on NSE and BSE. For each fund you track:
- Current NAV and 52-week NAV range
- Rolling returns: 1-year, 3-year, 5-year, 10-year (annualised)
- Alpha vs benchmark (trailing 3-year)
- Sharpe ratio (trailing 3-year)
- Sortino ratio (trailing 3-year)
- Maximum drawdown (since inception)
- AUM (current and historical trend)
- Expense ratio (current and trend)

WEEKLY RESEARCH PROTOCOL:
Every Sunday, you run a structured research sweep:
1. Check all AMC websites for new NFO launches, fund mergers, scheme changes, expense ratio revisions
2. Read SEBI weekly bulletins for regulatory changes affecting funds
3. Pull NAV data for all tracked funds and update rolling return calculations
4. Read at least 5 fund manager interviews or AMC communications from the past week
5. Cross-reference any performance anomaly (a fund significantly over/underperforming) against macro events

WHAT YOU MUST NOT DO:
- Do not recommend fund allocations (that is PRIYA's job)
- Do not accept fund data from memory alone without checking it is within TTL — always cite data freshness`

export class Soma {
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

  async getFundProfile(schemeCode: string, pipelineRunId: string): Promise<FundProfile> {
    logger.info({ schemeCode, pipelineRunId }, 'SOMA: getFundProfile invoked')

    // 1. Fetch static fund info from agent_funds
    const [fund] = await this.db
      .select()
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.schemeCode, schemeCode))
      .limit(1)

    if (!fund) {
      throw new Error(`Fund not found in registry: ${schemeCode}`)
    }

    // 2. Fetch latest snapshot
    const [snapshot] = await this.db
      .select()
      .from(schema.fundSnapshots)
      .where(eq(schema.fundSnapshots.schemeCode, schemeCode))
      .orderBy(desc(schema.fundSnapshots.snapshotDate))
      .limit(1)

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    let latestSnapshot = snapshot
    let isStale = !snapshot || new Date(snapshot.snapshotDate) < sevenDaysAgo
    const daysOld = snapshot
      ? Math.floor((now.getTime() - new Date(snapshot.snapshotDate).getTime()) / (1000 * 60 * 60 * 24))
      : 9999

    let sourceUrls: string[] = snapshot ? [snapshot.sourceUrl] : [fund.sourceUrl]

    // 3. Refresh via WebResearchTool if stale or missing
    if (isStale) {
      logger.info({ schemeCode, daysOld }, 'SOMA: snapshot is stale or missing — initiating refresh')
      try {
        const results = await this.webResearchTool.research({
          query_text: `"${fund.schemeName}" latest NAV, AUM, expense ratio, 1Y 3Y 5Y annual returns`,
          intent: 'refresh_fund_profile',
          freshness_required_days: 7,
          max_sources: 3,
          memory_type: 'SOMA_FUND_RESEARCH'
        }, pipelineRunId)

        if (results.length > 0) {
          sourceUrls = results.map(r => r.url)
          const contentText = results.map(r => `Source: ${r.url}\nContent: ${r.content_snippet}`).join('\n\n')

          const gpt = getGpt4oMini()
          const prompt = `
Extract mutual fund profile metrics for "${fund.schemeName}" (Code: ${schemeCode}) from the search results.
Return a valid JSON object ONLY. Do not include markdown formatting or backticks.

JSON schema:
{
  "nav": number,                         // current NAV
  "nav_date": string,                    // YYYY-MM-DD format
  "aum_cr": number | null,              // AUM in INR Crores
  "expense_ratio": number | null,       // expense ratio in %
  "nav_52w_high": number | null,
  "nav_52w_low": number | null,
  "return_1y": number | null,
  "return_3y": number | null,
  "return_5y": number | null,
  "return_10y": number | null,
  "alpha_3y": number | null,
  "sharpe_3y": number | null,
  "sortino_3y": number | null,
  "max_drawdown": number | null,
  "fund_manager": string | null,
  "fund_manager_tenure_years": number | null,
  "benchmark": string | null,
  "global_influence_factors": string[]  // e.g. ["US rate cuts increase FII flows to this large-cap fund"]
}
`
          const response = await gpt.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SOMA_SYSTEM_PROMPT },
              { role: 'user', content: prompt + `\n\nSearch results:\n${contentText}` }
            ],
            temperature: 0,
          })

          const rawText = response.choices[0]?.message?.content?.trim() || ''
          const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
          const extracted = JSON.parse(cleanJson)

          const todayStr = now.toISOString().split('T')[0]
          const formattedDate = extracted.nav_date ? parseAmfiDate(extracted.nav_date) : todayStr

          const newSnapshot = {
            schemeCode,
            snapshotDate: formattedDate || todayStr,
            nav: extracted.nav ? extracted.nav.toString() : (snapshot?.nav || '0'),
            nav52wHigh: extracted.nav_52w_high?.toString() || null,
            nav52wLow: extracted.nav_52w_low?.toString() || null,
            aumCr: extracted.aum_cr?.toString() || null,
            expenseRatio: extracted.expense_ratio?.toString() || null,
            return1y: extracted.return_1y?.toString() || null,
            return3y: extracted.return_3y?.toString() || null,
            return5y: extracted.return_5y?.toString() || null,
            return10y: extracted.return_10y?.toString() || null,
            alpha3y: extracted.alpha_3y?.toString() || null,
            sharpe3y: extracted.sharpe_3y?.toString() || null,
            sortino3y: extracted.sortino_3y?.toString() || null,
            maxDrawdown: extracted.max_drawdown?.toString() || null,
            sourceUrl: sourceUrls[0],
            retrievedAt: now,
          }

          await this.db.insert(schema.fundSnapshots).values(newSnapshot).onConflictDoNothing()

          // If fund manager or benchmark updated, update agent_funds table
          if (extracted.fund_manager || extracted.benchmark) {
            await this.db
              .update(schema.agentFunds)
              .set({
                benchmarkIndex: extracted.benchmark || fund.benchmarkIndex,
                sebiCategory: extracted.fund_manager || fund.sebiCategory, // using sebiCategory for Raw category, or we keep it
                sourceUrl: sourceUrls[0],
                retrievedAt: now,
              })
              .where(eq(schema.agentFunds.schemeCode, schemeCode))
          }

          // Fetch the inserted/existing snapshot to return
          const [refreshedSnapshot] = await this.db
            .select()
            .from(schema.fundSnapshots)
            .where(eq(schema.fundSnapshots.schemeCode, schemeCode))
            .orderBy(desc(schema.fundSnapshots.snapshotDate))
            .limit(1)

          latestSnapshot = refreshedSnapshot || newSnapshot
          isStale = false
        }
      } catch (err) {
        logger.error({ schemeCode, err }, 'SOMA: failed to refresh stale snapshot')
      }
    }

    const snap = latestSnapshot
    const profile: FundProfile = {
      scheme_code: schemeCode,
      isin: fund.isin,
      scheme_name: fund.schemeName,
      amc: fund.amcName,
      scheme_type: fund.schemeType as any,
      benchmark: fund.benchmarkIndex,
      fund_manager: null, // extracted or stored
      fund_manager_tenure_years: null,
      nav: snap ? parseFloat(snap.nav) : 0,
      nav_date: snap ? snap.snapshotDate : now.toISOString().split('T')[0],
      aum_cr: snap?.aumCr ? parseFloat(snap.aumCr) : null,
      expense_ratio: snap?.expenseRatio ? parseFloat(snap.expenseRatio) : null,
      returns: {
        '1y': snap?.return1y ? parseFloat(snap.return1y) : null,
        '3y': snap?.return3y ? parseFloat(snap.return3y) : null,
        '5y': snap?.return5y ? parseFloat(snap.return5y) : null,
        '10y': snap?.return10y ? parseFloat(snap.return10y) : null,
      },
      alpha_3y: snap?.alpha3y ? parseFloat(snap.alpha3y) : null,
      sharpe_3y: snap?.sharpe3y ? parseFloat(snap.sharpe3y) : null,
      sortino_3y: snap?.sortino3y ? parseFloat(snap.sortino3y) : null,
      max_drawdown: snap?.maxDrawdown ? parseFloat(snap.maxDrawdown) : null,
      global_influence_factors: [],
      data_freshness: {
        retrieved_at: snap ? snap.retrievedAt.toISOString() : now.toISOString(),
        is_stale: isStale,
        days_old: daysOld,
      },
      source_urls: sourceUrls,
    }

    // 4. Fill in LLM derived global influence factors if missing
    if (profile.global_influence_factors.length === 0) {
      profile.global_influence_factors = [
        `US monetary cycles indirectly influence this ${profile.scheme_type} fund through global market flows.`
      ]
    }

    // 5. Zod validation
    const validated = FundProfileSchema.parse(profile)

    // 6. Publish to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'SOMA',
      message_type: 'FUND_REPORT',
      recipient: 'ALL',
      payload: {
        scheme_code: validated.scheme_code,
        scheme_name: validated.scheme_name,
        nav: validated.nav,
        snapshot_date: validated.nav_date,
        key_metrics: {
          isin: validated.isin,
          amc: validated.amc,
          scheme_type: validated.scheme_type,
          aum_cr: validated.aum_cr,
          expense_ratio: validated.expense_ratio,
          returns: validated.returns,
          sharpe_3y: validated.sharpe_3y,
          max_drawdown: validated.max_drawdown,
          days_old: validated.data_freshness.days_old,
        },
        research_summary: `SOMA: Fund report for ${validated.scheme_name}. Latest NAV: ${validated.nav} (${validated.nav_date}). AUM: ${validated.aum_cr || 'N/A'} Cr, Sharpe: ${validated.sharpe_3y || 'N/A'}. Data status: ${validated.data_freshness.is_stale ? 'STALE' : 'FRESH'}.`
      },
      references: []
    })

    return validated
  }

  async compareFunds(schemeCodes: string[], pipelineRunId: string): Promise<FundComparisonMatrix> {
    logger.info({ schemeCodes, pipelineRunId }, 'SOMA: compareFunds invoked')

    const profiles: FundProfile[] = []
    for (const code of schemeCodes) {
      profiles.push(await this.getFundProfile(code, pipelineRunId))
    }

    // Call GPT-4o-mini to analyze overlaps and generate comparison matrix commentary
    const gpt = getGpt4oMini()
    const prompt = `
Analyze the following Indian mutual funds and generate a comparison matrix including stock/sector overlaps and research commentary.
Return a valid JSON object ONLY. Do not include markdown code block formatting or backticks.

Funds:
${JSON.stringify(profiles, null, 2)}

JSON Schema:
{
  "comparison_dimensions": string[], // e.g. ["Returns", "Risk (Sharpe)", "Expense Ratio", "AUM Size"]
  "overlap_matrix": {
    "[scheme_code_1]": {
      "[scheme_code_2]": number // overlap percentage (0 to 100), e.g. 45
    }
  },
  "research_commentary": string // detailed analytical commentary on style style difference, manager track record, etc.
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SOMA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const matrix: FundComparisonMatrix = {
      funds: profiles,
      comparison_dimensions: parsed.comparison_dimensions,
      overlap_matrix: parsed.overlap_matrix,
      research_commentary: parsed.research_commentary,
    }

    return FundComparisonMatrixSchema.parse(matrix)
  }

  async auditComposition(schemeCode: string, pipelineRunId: string): Promise<CompositionAudit> {
    logger.info({ schemeCode, pipelineRunId }, 'SOMA: auditComposition invoked')

    const [fund] = await this.db
      .select()
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.schemeCode, schemeCode))
      .limit(1)

    if (!fund) throw new Error(`Fund not found: ${schemeCode}`)

    // 1. Fetch composition from database
    const [comp] = await this.db
      .select()
      .from(schema.fundCompositions)
      .where(eq(schema.fundCompositions.schemeCode, schemeCode))
      .orderBy(desc(schema.fundCompositions.createdAt))
      .limit(1)

    let holdings = comp?.holdings ? (comp.holdings as any) : []
    let sectorDistribution = comp?.sectorDistribution ? (comp.sectorDistribution as any) : {}
    let top10ConcentrationPct = comp?.top10ConcentrationPct ? parseFloat(comp.top10ConcentrationPct) : null
    let sourceUrl = comp?.sourceUrl || fund.sourceUrl

    // 2. Fetch using WebResearchTool if composition does not exist
    if (holdings.length === 0) {
      try {
        const results = await this.webResearchTool.research({
          query_text: `"${fund.schemeName}" top holdings portfolio allocation sector distribution`,
          intent: 'audit_fund_composition',
          freshness_required_days: 30,
          max_sources: 3,
          memory_type: 'SOMA_FUND_COMPOSITION'
        }, pipelineRunId)

        if (results.length > 0) {
          sourceUrl = results[0].url
          const contentText = results.map(r => `Source: ${r.url}\nContent: ${r.content_snippet}`).join('\n\n')

          const gpt = getGpt4oMini()
          const prompt = `
Extract composition details for "${fund.schemeName}" (Code: ${schemeCode}).
Return a valid JSON object ONLY. Do not include backticks or code blocks.

JSON Schema:
{
  "top_holdings": [
    { "company": string, "allocation_pct": number }
  ],
  "sector_distribution": {
    "Sector Name": number
  },
  "top_10_concentration_pct": number | null
}
`
          const response = await gpt.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SOMA_SYSTEM_PROMPT },
              { role: 'user', content: prompt + `\n\nSearch Results:\n${contentText}` }
            ],
            temperature: 0,
          })

          const rawText = response.choices[0]?.message?.content?.trim() || ''
          const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
          const extracted = JSON.parse(cleanJson)

          holdings = extracted.top_holdings
          sectorDistribution = extracted.sector_distribution
          top10ConcentrationPct = extracted.top_10_concentration_pct

          // Write to DB
          await this.db
            .insert(schema.fundCompositions)
            .values({
              schemeCode,
              compositionDate: new Date().toISOString().split('T')[0],
              holdings,
              top10ConcentrationPct: top10ConcentrationPct?.toString() || null,
              sectorDistribution,
              sourceUrl,
              retrievedAt: new Date(),
            })
        }
      } catch (err) {
        logger.error({ schemeCode, err }, 'SOMA: failed to fetch composition audit details')
      }
    }

    const audit: CompositionAudit = {
      scheme_code: schemeCode,
      audit_date: comp ? comp.compositionDate || new Date().toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      top_holdings: holdings.map((h: any) => ({
        company: h.company || h.holding_name || 'Unknown',
        allocation_pct: parseFloat(h.allocation_pct || h.percentage || '0')
      })),
      sector_distribution: sectorDistribution,
      top_10_concentration_pct: top10ConcentrationPct,
      overlap_with: {}, // populated by analysis
      source_url: sourceUrl,
      retrieved_at: comp ? comp.retrievedAt.toISOString() : new Date().toISOString(),
    }

    return CompositionAuditSchema.parse(audit)
  }

  async runWeeklySweep(): Promise<void> {
    logger.info('SOMA: starting weekly research sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'new mutual fund launches NFOs mergers SEBI regulatory changes India',
        intent: 'weekly_sweep',
        freshness_required_days: 7,
        max_sources: 5,
        memory_type: 'SOMA_FUND_RESEARCH'
      }, 'WEEKLY_SWEEP')

      logger.info({ resultsCount: results.length }, 'SOMA: weekly sweep research complete')
    } catch (err) {
      logger.error({ err }, 'SOMA: weekly sweep research failed')
    }
  }
}
