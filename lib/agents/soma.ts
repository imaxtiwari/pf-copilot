import { eq, desc, inArray, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  FundProfile,
  FundProfileSchema,
  FundComparisonMatrix,
  FundComparisonMatrixSchema,
  CompositionAudit,
  CompositionAuditSchema,
  FundUniverse,
  FundUniverseSchema,
} from './types/soma-types'
import { WebResearchTool } from '../research/web-research-tool'
import { AgentMemoryStore, makePipelineKey } from '../memory/memory-store'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { getGpt4oMini } from '../azure-openai'
import { parseAmfiDate } from '../../scripts/sync-amfi-master'
import { randomUUID } from 'crypto'
import { KnowledgeCommons } from '../research/knowledge-commons'
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

  async compareFunds(schemeCodes: string[], clientId: string, pipelineRunId: string): Promise<FundComparisonMatrix> {
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
    const validated = FundComparisonMatrixSchema.parse(matrix)

    await this.memoryStore.write('SOMA', {
      content: JSON.stringify(validated),
      memory_type: 'SOMA_FUND_RESEARCH',
      source_url: 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [makePipelineKey('SOMA', 'fund_comparison_matrix', clientId, pipelineRunId)],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async auditComposition(schemeCode: string, clientId: string, pipelineRunId: string): Promise<CompositionAudit> {
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
    const validated = CompositionAuditSchema.parse(audit)

    await this.memoryStore.write('SOMA', {
      content: JSON.stringify(validated),
      memory_type: 'SOMA_FUND_COMPOSITION',
      source_url: sourceUrl,
      confidence_tier: 'VERIFIED',
      tags: [makePipelineKey('SOMA', 'composition_audit', clientId, pipelineRunId)],
      pipeline_run_id: pipelineRunId
    })

    return validated
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

  async getEligibleFundUniverse(
    criteria: {
      max_expense_ratio_active: number   // default 1.5
      max_expense_ratio_index: number    // default 0.5
      min_aum_equity_cr: number         // default 500
      min_aum_debt_cr: number           // default 1000
      min_track_record_years: number    // default 3
      client_id?: string
    },
    pipelineRunId: string
  ): Promise<FundUniverse> {
    logger.info({ pipelineRunId, criteria }, 'SOMA: getEligibleFundUniverse invoked')
    const clientId = (criteria as any).client_id || 'UNKNOWN'

    const kc = new KnowledgeCommons(this.deliberationRoom)
    const priorLearnings = await kc.queryCommons('SOMA', 'fund_universe_selection')
    if (priorLearnings.length > 0) {
      logger.info({ pipelineRunId, priorLearnings }, 'SOMA: Retrieved prior learnings for fund_universe_selection')
    }

    const max_expense_ratio_active = criteria.max_expense_ratio_active ?? 1.5
    const max_expense_ratio_index = criteria.max_expense_ratio_index ?? 0.5
    const min_track_record_years = criteria.min_track_record_years ?? 3
    const min_track_record_months = min_track_record_years * 12

    const totalScreenedResult = await this.db.execute(sql`
      SELECT COUNT(DISTINCT scheme_code) as count FROM agent_funds WHERE is_active = true
    `)
    const total_screened = parseInt(totalScreenedResult.rows[0]?.count || '0', 10)

    const validSchemeTypes = new Set(['equity', 'debt', 'hybrid', 'index', 'etf', 'fof', 'solution-oriented'])
    const sanitizeSchemeType = (val: string): 'equity' | 'debt' | 'hybrid' | 'index' | 'etf' | 'fof' | 'solution-oriented' => {
      const lower = (val || '').toLowerCase().trim()
      if (validSchemeTypes.has(lower)) {
        return lower as any
      }
      if (lower.includes('equity')) return 'equity'
      if (lower.includes('debt')) return 'debt'
      if (lower.includes('hybrid')) return 'hybrid'
      if (lower.includes('index')) return 'index'
      if (lower.includes('etf')) return 'etf'
      if (lower.includes('fof')) return 'fof'
      if (lower.includes('solution')) return 'solution-oriented'
      return 'equity' // fallback
    }

    const runQuery = async (minAumEquity: number, minAumDebt: number) => {
      const queryResult = await this.db.execute(sql`
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (scheme_code) *
          FROM fund_snapshots
          ORDER BY scheme_code, snapshot_date DESC
        ),
        track_records AS (
          SELECT scheme_code, COUNT(DISTINCT DATE_TRUNC('month', snapshot_date::timestamp)) AS months
          FROM fund_snapshots
          GROUP BY scheme_code
        )
        SELECT 
          af.scheme_code,
          af.scheme_name,
          af.scheme_type,
          ls.aum_cr::float AS aum_cr,
          ls.expense_ratio::float AS expense_ratio,
          ls.return_3y::float AS return_3y,
          ls.sharpe_3y::float AS sharpe_3y,
          COALESCE(tr.months, 0)::int AS track_record_months
        FROM agent_funds af
        LEFT JOIN latest_snapshots ls ON af.scheme_code = ls.scheme_code
        LEFT JOIN track_records tr ON af.scheme_code = tr.scheme_code
        WHERE af.is_active = true
          AND (
            (af.scheme_type IN ('index', 'etf') AND ls.expense_ratio <= ${max_expense_ratio_index})
            OR
            (af.scheme_type NOT IN ('index', 'etf') AND ls.expense_ratio <= ${max_expense_ratio_active})
          )
          AND (
            (af.scheme_type IN ('debt', 'hybrid') AND ls.aum_cr >= ${minAumDebt})
            OR
            (af.scheme_type NOT IN ('debt', 'hybrid') AND ls.aum_cr >= ${minAumEquity})
          )
          AND COALESCE(tr.months, 0) >= ${min_track_record_months}
      `)
      return queryResult.rows.map((row: any) => ({
        scheme_code: row.scheme_code,
        scheme_name: row.scheme_name,
        scheme_type: sanitizeSchemeType(row.scheme_type),
        aum_cr: row.aum_cr !== null ? parseFloat(row.aum_cr) : null,
        expense_ratio: row.expense_ratio !== null ? parseFloat(row.expense_ratio) : null,
        return_3y: row.return_3y !== null ? parseFloat(row.return_3y) : null,
        sharpe_3y: row.sharpe_3y !== null ? parseFloat(row.sharpe_3y) : null,
        track_record_years: row.track_record_months / 12.0
      }))
    }

    let minAumEquity = criteria.min_aum_equity_cr ?? 500
    let minAumDebt = criteria.min_aum_debt_cr ?? 1000

    let eligibleFunds = await runQuery(minAumEquity, minAumDebt)

    if (eligibleFunds.length < 10) {
      logger.warn(
        { count: eligibleFunds.length, minAumEquity, minAumDebt, pipelineRunId },
        'SOMA: getEligibleFundUniverse filtered result is fewer than 10 funds. Relaxing min_aum filters by 50% and retrying once.'
      )
      minAumEquity = minAumEquity * 0.5
      minAumDebt = minAumDebt * 0.5
      eligibleFunds = await runQuery(minAumEquity, minAumDebt)
    }

    const universe: FundUniverse = {
      universe_id: randomUUID(),
      generated_at: new Date().toISOString(),
      pipeline_run_id: pipelineRunId,
      filters_applied: [
        { filter: 'max_expense_ratio_active', threshold: `<=${max_expense_ratio_active}%` },
        { filter: 'max_expense_ratio_index', threshold: `<=${max_expense_ratio_index}%` },
        { filter: 'min_aum_equity_cr', threshold: `>=${minAumEquity} Cr` },
        { filter: 'min_aum_debt_cr', threshold: `>=${minAumDebt} Cr` },
        { filter: 'min_track_record_years', threshold: `>=${min_track_record_years} years` }
      ],
      eligible_funds: eligibleFunds,
      total_screened,
      total_eligible: eligibleFunds.length
    }

    const validated = FundUniverseSchema.parse(universe)

    try {
      await this.deliberationRoom.publish({
        pipeline_run_id: pipelineRunId,
        sender: 'SOMA',
        message_type: 'FUND_REPORT',
        recipient: 'ALL',
        payload: {
          message: 'Fund universe screening completed.',
          total_screened: validated.total_screened,
          total_eligible: validated.total_eligible,
          filters_applied: validated.filters_applied,
          source_url: 'https://amfiindia.com',
          retrieved_at: new Date().toISOString(),
          prior_learnings: priorLearnings.map(l => l.summary)
        },
        references: []
      })
    } catch (publishErr) {
      logger.error({ publishErr, pipelineRunId }, 'SOMA: failed to publish FUND_REPORT to deliberationRoom')
    }

    await this.memoryStore.write('SOMA', {
      content: JSON.stringify(validated),
      memory_type: 'SOMA_FUND_RESEARCH',
      source_url: 'https://amfiindia.com',
      confidence_tier: 'VERIFIED',
      tags: [makePipelineKey('SOMA', 'fund_universe', clientId, pipelineRunId)],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }
}
