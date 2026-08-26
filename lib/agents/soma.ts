import { eq, desc, sql } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import * as schema from '@/db/schema'
import { db } from '@/lib/db'
import {
  FundProfile,
  FundProfileSchema,
  FundUniverse,
  FundUniverseSchema,
  FundComparisonMatrix,
  FundComparisonMatrixSchema,
  CompositionAudit,
  CompositionAuditSchema,
} from '@/lib/agents/types'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { writeMemory } from '@/lib/memory/memory-store'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { SOMA_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'
import logger from '@/lib/logger'

export { SOMA_SYSTEM_PROMPT_V1 }

const FRESHNESS_DAYS = 7

function sanitizeSchemeType(type: string | null): FundProfile['scheme_type'] {
  const valid: FundProfile['scheme_type'][] = [
    'equity',
    'debt',
    'hybrid',
    'index',
    'etf',
    'fof',
    'solution-oriented',
  ]
  return valid.includes(type as FundProfile['scheme_type']) ? (type as FundProfile['scheme_type']) : 'equity'
}

function makePipelineKey(agent: string, artifact: string, clientId: string, pipelineRunId: string): string {
  return `${agent}:${artifact}:${clientId}:${pipelineRunId}`
}

export interface UniverseCriteria {
  max_expense_ratio_active_pct?: number
  max_expense_ratio_index_pct?: number
  min_aum_equity_cr?: number
  min_aum_debt_cr?: number
  min_track_record_years?: number
}

/**
 * SOMA — Systematic Observatory for Market Analysis.
 *
 * SOMA curates the fund universe, builds per-fund profiles, compares funds,
 * and audits portfolio composition. It operates as an educational data layer:
 * it explains what it knows and where the data came from, but it never tells
 * a client which funds to buy.
 */
export class Soma {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private dbClient: typeof db

  constructor(
    deliberationRoom: DeliberationRoom,
    webResearchTool: WebResearchTool,
    dbClient: typeof db = db,
  ) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.dbClient = dbClient
  }

  async getFundProfile(schemeCode: string, pipelineRunId: string, clientId?: string): Promise<FundProfile> {
    logger.info({ schemeCode, pipelineRunId }, 'SOMA: getFundProfile invoked')

    const [fund] = await this.dbClient
      .select()
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.schemeCode, schemeCode))

    if (!fund) {
      throw new Error(`SOMA: Fund not found in agent_funds: ${schemeCode}`)
    }

    const [latestSnapshot] = await this.dbClient
      .select()
      .from(schema.fundSnapshots)
      .where(eq(schema.fundSnapshots.schemeCode, schemeCode))
      .orderBy(desc(schema.fundSnapshots.snapshotDate))
      .limit(1)

    const now = new Date()
    const snapshotDate = latestSnapshot ? new Date(latestSnapshot.snapshotDate) : null
    const daysOld = snapshotDate
      ? Math.floor((now.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60 * 24))
      : Infinity
    const isStale = !snapshotDate || daysOld > FRESHNESS_DAYS

    const profile: FundProfile = {
      scheme_code: schemeCode,
      isin: null,
      scheme_name: fund.schemeName,
      amc: fund.amcName ?? null,
      scheme_type: sanitizeSchemeType(fund.schemeType),
      benchmark: null,
      fund_manager: null,
      fund_manager_tenure_years: null,
      nav: latestSnapshot ? parseFloat(String(latestSnapshot.nav)) : 0,
      nav_date: snapshotDate ? snapshotDate.toISOString().split('T')[0] : now.toISOString().split('T')[0],
      aum_cr: fund.aum ? parseFloat(String(fund.aum)) : null,
      expense_ratio: fund.expenseRatio ? parseFloat(String(fund.expenseRatio)) : null,
      returns: {
        '1y': null,
        '3y': null,
        '5y': null,
        '10y': null,
      },
      alpha_3y: null,
      sharpe_3y: null,
      sortino_3y: null,
      max_drawdown: null,
      global_influence_factors: [
        `US monetary cycles and FII flows indirectly influence this ${sanitizeSchemeType(fund.schemeType)} fund.`,
      ],
      data_freshness: {
        retrieved_at: latestSnapshot ? latestSnapshot.createdAt?.toISOString?.() ?? now.toISOString() : now.toISOString(),
        is_stale: isStale,
        days_old: daysOld === Infinity ? 999 : daysOld,
      },
      source_urls: latestSnapshot ? ['https://amfiindia.com'] : [],
    }

    const validated = FundProfileSchema.parse(profile)

    try {
      await this.deliberationRoom.bind(pipelineRunId).publish({
        sender: 'SOMA',
        message_type: 'FUND_REPORT',
        recipient: 'ALL',
        content: '',
        payload: {
          scheme_code: validated.scheme_code,
          scheme_name: validated.scheme_name,
          nav: validated.nav,
          snapshot_date: validated.nav_date,
          key_metrics: { aum_cr: validated.aum_cr, expense_ratio: validated.expense_ratio },
          research_summary: `Data freshness: ${validated.data_freshness.days_old} days old.`,
        },
        references: [],
      })
    } catch (publishErr) {
      logger.error({ publishErr, pipelineRunId }, 'SOMA: failed to publish FUND_REPORT')
    }

    if (clientId) {
      try {
        await writeMemory(
          'SOMA',
          makePipelineKey('SOMA', 'fund_profile', clientId, pipelineRunId),
          {
            content: validated,
            memory_type: 'SOMA_FUND_RESEARCH',
            source_url: 'https://amfiindia.com',
            confidence_tier: isStale ? 'ASSUMED' : 'VERIFIED',
            tags: [makePipelineKey('SOMA', 'fund_profile', clientId, pipelineRunId)],
            pipeline_run_id: pipelineRunId,
          },
        )
      } catch (memErr) {
        logger.warn({ memErr, schemeCode }, 'SOMA: failed to write fund profile memory')
      }
    }

    return validated
  }

  async compareFunds(
    schemeCodes: string[],
    clientId: string,
    pipelineRunId: string,
  ): Promise<FundComparisonMatrix> {
    logger.info({ schemeCodes, pipelineRunId }, 'SOMA: compareFunds invoked')

    const profiles: FundProfile[] = []
    for (const code of schemeCodes) {
      profiles.push(await this.getFundProfile(code, pipelineRunId, clientId))
    }

    const overlap_matrix: Record<string, Record<string, number>> = {}
    for (const a of schemeCodes) {
      overlap_matrix[a] = {}
      for (const b of schemeCodes) {
        overlap_matrix[a][b] = a === b ? 100 : 0
      }
    }

    const matrix: FundComparisonMatrix = {
      funds: profiles,
      comparison_dimensions: ['AUM', 'Expense Ratio', 'NAV Freshness'],
      overlap_matrix,
      research_commentary:
        'Comparison is based on available fund snapshot data. Overlap analysis requires detailed composition data.',
    }

    const validated = FundComparisonMatrixSchema.parse(matrix)

    try {
      await writeMemory(
        'SOMA',
        makePipelineKey('SOMA', 'fund_comparison_matrix', clientId, pipelineRunId),
        {
          content: validated,
          memory_type: 'SOMA_FUND_RESEARCH',
          source_url: 'Internal',
          confidence_tier: 'VERIFIED',
          tags: [makePipelineKey('SOMA', 'fund_comparison_matrix', clientId, pipelineRunId)],
          pipeline_run_id: pipelineRunId,
        },
      )
    } catch (memErr) {
      logger.warn({ memErr }, 'SOMA: failed to write comparison matrix memory')
    }

    return validated
  }

  async auditComposition(
    schemeCode: string,
    clientId: string,
    pipelineRunId: string,
  ): Promise<CompositionAudit> {
    logger.info({ schemeCode, pipelineRunId }, 'SOMA: auditComposition invoked')

    const [fund] = await this.dbClient
      .select()
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.schemeCode, schemeCode))
      .limit(1)

    if (!fund) {
      throw new Error(`SOMA: Fund not found: ${schemeCode}`)
    }

    const rows = await this.dbClient
      .select()
      .from(schema.fundCompositions)
      .where(eq(schema.fundCompositions.schemeCode, schemeCode))

    const holdings = rows.map((r) => ({
      company: r.holdingName ?? 'Unknown',
      allocation_pct: r.weight ? parseFloat(String(r.weight)) : 0,
    }))

    const sectorDistribution: Record<string, number> = {}
    for (const r of rows) {
      if (!r.sector) continue
      sectorDistribution[r.sector] = (sectorDistribution[r.sector] ?? 0) + (r.weight ? parseFloat(String(r.weight)) : 0)
    }

    const audit: CompositionAudit = {
      scheme_code: schemeCode,
      audit_date: new Date().toISOString().split('T')[0],
      top_holdings: holdings,
      sector_distribution: sectorDistribution,
      top_10_concentration_pct: holdings.reduce((sum, h) => sum + h.allocation_pct, 0),
      overlap_with: {},
      source_url: 'https://amfiindia.com',
      retrieved_at: new Date().toISOString(),
    }

    const validated = CompositionAuditSchema.parse(audit)

    try {
      await writeMemory(
        'SOMA',
        makePipelineKey('SOMA', 'composition_audit', clientId, pipelineRunId),
        {
          content: validated,
          memory_type: 'SOMA_FUND_COMPOSITION',
          source_url: 'https://amfiindia.com',
          confidence_tier: 'VERIFIED',
          tags: [makePipelineKey('SOMA', 'composition_audit', clientId, pipelineRunId)],
          pipeline_run_id: pipelineRunId,
        },
      )
    } catch (memErr) {
      logger.warn({ memErr }, 'SOMA: failed to write composition audit memory')
    }

    return validated
  }


  async getEligibleFundUniverse(
    pipelineRunId: string,
    clientId: string,
    criteria: UniverseCriteria = {},
  ): Promise<FundUniverse> {
    logger.info({ pipelineRunId, clientId }, 'SOMA: getEligibleFundUniverse invoked')

    const max_expense_ratio_active = criteria.max_expense_ratio_active_pct ?? 2.0
    const max_expense_ratio_index = criteria.max_expense_ratio_index_pct ?? 0.5
    const min_track_record_years = criteria.min_track_record_years ?? 3

    const allFunds = await this.dbClient
      .select({ schemeCode: schema.agentFunds.schemeCode })
      .from(schema.agentFunds)
      .where(eq(schema.agentFunds.isActive, true))

    const total_screened = allFunds.length

    const runQuery = async (minAumEquity: number, minAumDebt: number) => {
      const queryResult = await this.dbClient.execute(sql`
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (scheme_code)
            scheme_code,
            snapshot_date,
            nav
          FROM fund_snapshots
          ORDER BY scheme_code, snapshot_date DESC
        ),
        earliest_snapshots AS (
          SELECT DISTINCT ON (scheme_code)
            scheme_code,
            snapshot_date
          FROM fund_snapshots
          ORDER BY scheme_code, snapshot_date ASC
        ),
        track_records AS (
          SELECT
            ls.scheme_code,
            COALESCE(
              EXTRACT(YEAR FROM AGE(ls.snapshot_date, es.snapshot_date)) * 12 +
              EXTRACT(MONTH FROM AGE(ls.snapshot_date, es.snapshot_date)),
              0
            )::int AS months
          FROM latest_snapshots ls
          LEFT JOIN earliest_snapshots es ON ls.scheme_code = es.scheme_code
        )
        SELECT
          af.scheme_code,
          af.scheme_name,
          af.scheme_type,
          af.aum::float AS aum_cr,
          af.expense_ratio::float AS expense_ratio,
          ls.nav::float AS nav,
          COALESCE(tr.months, 0)::int AS track_record_months
        FROM agent_funds af
        LEFT JOIN latest_snapshots ls ON af.scheme_code = ls.scheme_code
        LEFT JOIN track_records tr ON af.scheme_code = tr.scheme_code
        WHERE af.is_active = true
          AND (
            (af.scheme_type IN ('index', 'etf') AND af.expense_ratio <= ${max_expense_ratio_index})
            OR
            (af.scheme_type NOT IN ('index', 'etf') AND af.expense_ratio <= ${max_expense_ratio_active})
          )
          AND (
            (af.scheme_type IN ('debt', 'hybrid') AND af.aum >= ${minAumDebt})
            OR
            (af.scheme_type NOT IN ('debt', 'hybrid') AND af.aum >= ${minAumEquity})
          )
          AND COALESCE(tr.months, 0) >= ${min_track_record_years * 12}
      `)

      return queryResult.rows.map((row: any) => ({
        scheme_code: row.scheme_code,
        scheme_name: row.scheme_name,
        scheme_type: sanitizeSchemeType(row.scheme_type),
        aum_cr: row.aum_cr !== null ? parseFloat(row.aum_cr) : null,
        expense_ratio: row.expense_ratio !== null ? parseFloat(row.expense_ratio) : null,
        return_3y: null,
        sharpe_3y: null,
        track_record_years: row.track_record_months / 12.0,
      }))
    }

    let minAumEquity = criteria.min_aum_equity_cr ?? 500
    let minAumDebt = criteria.min_aum_debt_cr ?? 1000

    let eligibleFunds = await runQuery(minAumEquity, minAumDebt)

    if (eligibleFunds.length < 10) {
      logger.warn(
        { count: eligibleFunds.length, minAumEquity, minAumDebt, pipelineRunId },
        'SOMA: getEligibleFundUniverse filtered result is fewer than 10 funds. Relaxing min_aum filters by 50% and retrying once.',
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
        { filter: 'min_track_record_years', threshold: `>=${min_track_record_years} years` },
      ],
      eligible_funds: eligibleFunds,
      total_screened,
      total_eligible: eligibleFunds.length,
    }

    const validated = FundUniverseSchema.parse(universe)

    try {
      await this.deliberationRoom.bind(pipelineRunId).publish({
        sender: 'SOMA',
        message_type: 'FUND_REPORT',
        recipient: 'ALL',
        content: '',
        payload: {
          message: 'Fund universe screening completed.',
          total_screened: validated.total_screened,
          total_eligible: validated.total_eligible,
          filters_applied: validated.filters_applied,
          source_url: 'https://amfiindia.com',
          retrieved_at: new Date().toISOString(),
        },
        references: [],
      })
    } catch (publishErr) {
      logger.error({ publishErr, pipelineRunId }, 'SOMA: failed to publish FUND_REPORT to deliberationRoom')
    }

    try {
      await writeMemory(
        'SOMA',
        makePipelineKey('SOMA', 'fund_universe', clientId, pipelineRunId),
        {
          content: validated,
          memory_type: 'SOMA_FUND_RESEARCH',
          source_url: 'https://amfiindia.com',
          confidence_tier: 'VERIFIED',
          tags: [makePipelineKey('SOMA', 'fund_universe', clientId, pipelineRunId)],
          pipeline_run_id: pipelineRunId,
        },
      )
    } catch (memErr) {
      logger.warn({ memErr, pipelineRunId }, 'SOMA: failed to write fund universe memory')
    }

    return validated
  }
}

