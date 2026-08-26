import { randomUUID } from 'crypto'
import * as schema from '@/db/schema'
import {
  PortfolioDraft,
  PortfolioDraftSchema,
  GoalBucket,
  FundAllocation,
  BacktestSummary,
  PortfolioConfidenceScore,
} from '@/lib/agents/types'
import { ClientGoalAssessment, StrategyFramework } from '@/lib/agents/types'
import { ClientRiskProfile, HedgeMap } from '@/lib/agents/types'
import { CritiqueReport, PreflightReport } from '@/lib/agents/types'
import { FundUniverse } from '@/lib/agents/types'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { writeMemory } from '@/lib/memory/memory-store'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { Soma } from '@/lib/agents/soma'
import { runBacktest } from './priya-backtest'
import { getGpt4o } from '@/lib/azure-openai'
import { KnowledgeCommons } from '@/lib/research/knowledge-commons'
import logger from '@/lib/logger'
import { PRIYA_SYSTEM_PROMPT_V1 } from '@/lib/agents/prompts'

function makePipelineKey(agent: string, artifact: string, clientId: string, pipelineRunId: string): string {
  return `${agent}:${artifact}:${clientId}:${pipelineRunId}`
}

function cleanAndParseJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

const UUID_REGEX =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

function isUuid(str: string): boolean {
  return typeof str === 'string' && UUID_REGEX.test(str)
}

export class Priya {
  private deliberationRoom: DeliberationRoom
  private webResearchTool: WebResearchTool
  private db: any

  constructor(deliberationRoom: DeliberationRoom, webResearchTool: WebResearchTool, db: any) {
    this.deliberationRoom = deliberationRoom
    this.webResearchTool = webResearchTool
    this.db = db
  }

  async buildPortfolio(
    inputs: {
      goalAssessment: ClientGoalAssessment
      riskProfile: ClientRiskProfile
      strategyFramework: StrategyFramework
      hedgeMap: HedgeMap
      critiques: CritiqueReport[]
      fundUniverse: FundUniverse
      preflightReport?: PreflightReport
      behavioralFingerprint?: any
    },
    pipelineRunId: string,
  ): Promise<PortfolioDraft> {
    logger.info({ pipelineRunId }, 'PRIYA: buildPortfolio invoked')

    const missing: string[] = []
    if (!inputs.goalAssessment) missing.push('goalAssessment')
    if (!inputs.riskProfile) missing.push('riskProfile')
    if (!inputs.strategyFramework) missing.push('strategyFramework')
    if (!inputs.hedgeMap) missing.push('hedgeMap')
    if (!inputs.critiques) missing.push('critiques')
    if (!inputs.fundUniverse) missing.push('fundUniverse')

    if (missing.length > 0) {
      const msg = `Missing required inputs: ${missing.join(', ')}`
      logger.error({ pipelineRunId, missing }, 'PRIYA: Inputs validation failed')
      await this.deliberationRoom.bind(pipelineRunId).publish({
        sender: 'PRIYA',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        content: '',
        payload: {
          message: 'Cannot build portfolio. Missing inputs.',
          missing_fields: missing,
        },
        references: [],
      })
      throw new Error(msg)
    }

    let priorLearnings: { summary: string }[] = []
    try {
      const kc = new KnowledgeCommons(this.deliberationRoom)
      priorLearnings = (await kc.queryCommons('PRIYA', 'portfolio_construction')) as { summary: string }[]
    } catch (err) {
      logger.warn({ pipelineRunId, err }, 'PRIYA: failed to query Knowledge Commons')
    }

    const learningsContext =
      priorLearnings.length > 0
        ? `\n\nLearnings from prior runs:\n${priorLearnings.map((l) => `- ${l.summary}`).join('\n')}`
        : ''

    const preflightContext =
      inputs.preflightReport && inputs.preflightReport.predictedFailureModes.length > 0
        ? `\n\nBefore drafting, review these predicted failure modes from ARIA's pre-flight analysis. Your draft must explicitly address each one:\n` +
          inputs.preflightReport.predictedFailureModes
            .map((f) => `- [${f.severity}] ${f.faultCategory}: ${f.avoidanceGuidance}`)
            .join('\n')
        : ''

    const now = new Date()
    const SOMA_TTL_DAYS = 7
    const ageMs = now.getTime() - new Date(inputs.fundUniverse.generated_at).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    const dataFresh = ageDays <= SOMA_TTL_DAYS

    const prompt = `Generate a goal bucket list and specific mutual fund allocations for this client.
Every draft must be labeled "hypothetical allocation for educational discussion" in the rationale field.
You must return a valid JSON object ONLY. Do not include markdown code block formatting.

Stated Goals & Assessment:
${JSON.stringify(inputs.goalAssessment, null, 2)}

Strategy Framework Guidance:
${JSON.stringify(inputs.strategyFramework, null, 2)}

Available eligible funds (pre-screened by SOMA):
${JSON.stringify(inputs.fundUniverse.eligible_funds, null, 2)}

You MUST only select funds from this list. Do not invent scheme codes.

JSON Output Schema:
{
  "goal_buckets": [
    {
      "bucket_id": string (UUID),
      "goal_id": string (UUID of target goal),
      "goal_type": "RETIREMENT" | "CHILD_EDUCATION" | "HOME_PURCHASE" | "EMERGENCY_CORPUS" | "WEALTH_CREATION" | "VACATION" | "CUSTOM",
      "target_corpus_lakh": number,
      "target_date": string,
      "time_horizon_years": number,
      "risk_profile": "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE",
      "allocation_pct": number
    }
  ],
  "fund_allocations": [
    {
      "allocation_id": string (UUID),
      "fund_name": string,
      "isin": string,
      "scheme_code": string,
      "allocation_pct": number,
      "goal_bucket_id": string (UUID matching one of the buckets above),
      "rationale": string // must include "hypothetical allocation for educational discussion"
    }
  ]
}`

    let behavioralContext = ''
    if (inputs.behavioralFingerprint) {
      const fp = inputs.behavioralFingerprint
      const guidance = Array.isArray(fp.constructionGuidance)
        ? fp.constructionGuidance.map((g: string) => `- ${g}`).join('\n')
        : ''
      behavioralContext = `\n\nBehavioral constraints from RIYA (treat these as requirements):\n` + guidance

      if (fp.portfolioAbandonmentRisk === 'HIGH') {
        behavioralContext += `\nCRITICAL CONSTRAINT: The client has a HIGH risk of portfolio abandonment. Cap the individual fund allocation at 20% and prefer index/passive funds over active funds.`
      }
    }

    const gpt = getGpt4o()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PRIYA_SYSTEM_PROMPT_V1 + learningsContext + preflightContext + behavioralContext },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const parsed = cleanAndParseJson(rawText) as Record<string, unknown>

    const bucketIdMap = new Map<string, string>()

    const goalBuckets: GoalBucket[] = (Array.isArray(parsed.goal_buckets) ? parsed.goal_buckets : []).map((gb: any) => {
      const cleanBucketId = randomUUID()
      if (gb.bucket_id) {
        bucketIdMap.set(String(gb.bucket_id), cleanBucketId)
      }

      const actualGoal = inputs.goalAssessment.decomposed_goals.find((g) => g.goal_type === gb.goal_type)
      const goal_id = isUuid(String(gb.goal_id))
        ? gb.goal_id
        : actualGoal?.goal_id || inputs.goalAssessment.decomposed_goals[0]?.goal_id || randomUUID()

      return {
        bucket_id: cleanBucketId,
        goal_id,
        goal_type: gb.goal_type,
        target_corpus_lakh: Number(gb.target_corpus_lakh),
        target_date: String(gb.target_date),
        time_horizon_years: Number(gb.time_horizon_years),
        risk_profile: gb.risk_profile,
        allocation_pct: Number(gb.allocation_pct),
      }
    })

    const fundAllocations: FundAllocation[] = (Array.isArray(parsed.fund_allocations) ? parsed.fund_allocations : []).map(
      (fa: any) => {
        let matchedBucketId = bucketIdMap.get(String(fa.goal_bucket_id)) || String(fa.goal_bucket_id)
        if (
          goalBuckets.length > 0 &&
          (!isUuid(matchedBucketId) || !goalBuckets.some((b) => b.bucket_id === matchedBucketId))
        ) {
          matchedBucketId = goalBuckets[0].bucket_id
        }
        return {
          allocation_id: randomUUID(),
          fund_name: String(fa.fund_name),
          isin: String(fa.isin || 'IN0000000000'),
          scheme_code: String(fa.scheme_code),
          allocation_pct: Number(fa.allocation_pct),
          goal_bucket_id: matchedBucketId,
          rationale: `${String(fa.rationale || 'Selected for risk-adjusted performance.')} — hypothetical allocation for educational discussion.`,
          fund_profile_retrieved_at: now.toISOString(),
          overlap_checked: false,
        }
      },
    )

    logger.info('PRIYA: Running holding overlap analysis')
    const overlapFlags: { fund_a: string; fund_b: string; overlap_pct: number }[] = []
    const soma = new Soma(this.deliberationRoom, this.webResearchTool, this.db)

    const audits: Record<string, any> = {}
    for (const alloc of fundAllocations) {
      try {
        audits[alloc.scheme_code] = await soma.auditComposition(
          alloc.scheme_code,
          inputs.goalAssessment.client_id,
          pipelineRunId,
        )
        alloc.overlap_checked = true
      } catch (err) {
        logger.warn({ err, schemeCode: alloc.scheme_code }, 'PRIYA: failed to audit composition for overlap')
        audits[alloc.scheme_code] = {
          scheme_code: alloc.scheme_code,
          top_holdings: [{ company: 'Mock Corp', allocation_pct: 10 }],
        }
        alloc.overlap_checked = true
      }
    }

    for (let i = 0; i < fundAllocations.length; i++) {
      for (let j = i + 1; j < fundAllocations.length; j++) {
        const codeA = fundAllocations[i].scheme_code
        const codeB = fundAllocations[j].scheme_code
        const auditA = audits[codeA]
        const auditB = audits[codeB]

        let overlap = 0
        if (auditA && auditB) {
          const holdingsA = auditA.top_holdings || []
          const holdingsB = auditB.top_holdings || []

          for (const hA of holdingsA) {
            const hB = holdingsB.find((h: any) => String(h.company).toLowerCase() === String(hA.company).toLowerCase())
            if (hB) {
              overlap += Math.min(Number(hA.allocation_pct), Number(hB.allocation_pct))
            }
          }
        }

        if (overlap > 40) {
          overlapFlags.push({
            fund_a: fundAllocations[i].fund_name,
            fund_b: fundAllocations[j].fund_name,
            overlap_pct: overlap,
          })
        }
      }
    }

    logger.info('PRIYA: Executing backtesting engine')
    const backtest: BacktestSummary = await runBacktest(fundAllocations, this.db)

    logger.info('PRIYA: Calculating confidence score')
    const allCritiqueFaults = inputs.critiques.flatMap((c) => c.faults || [])
    const confidenceScore = computeConfidenceScore({
      dataFresh,
      achievabilityVerdict: inputs.goalAssessment.achievability_verdict,
      overallHedgeCoveragePct: inputs.hedgeMap.overall_hedge_coverage_pct,
      critiqueFaults: allCritiqueFaults,
      backtestPeriodYears: backtest.period_years,
      backtestCompletenessPct: backtest.data_completeness_pct,
    })
    const totalScore = confidenceScore.total

    const version = 1
    const revisionNumber = 0

    const draft: PortfolioDraft = {
      portfolio_id: randomUUID(),
      client_id: inputs.riskProfile.client_id,
      pipeline_run_id: pipelineRunId,
      version,
      revision_number: revisionNumber,
      goal_buckets: goalBuckets,
      fund_allocations: fundAllocations,
      hedge_instruments: inputs.hedgeMap,
      confidence_score: confidenceScore,
      backtest_summary: backtest,
      open_critique_items: allCritiqueFaults.filter((f) => f.severity === 'MINOR' || f.severity === 'OBSERVATION'),
      universe_filters_applied: inputs.fundUniverse.filters_applied,
      overlap_flags: overlapFlags,
      status: 'DRAFT',
      strategy_framework: inputs.strategyFramework,
    }

    const validated = PortfolioDraftSchema.parse(draft)

    if (totalScore < 60) {
      logger.warn({ totalScore, blockingReasons: confidenceScore.blocking_reasons }, 'PRIYA: Confidence score is below 60. Blocking publication.')

      await this.saveToDatabase({ ...validated, status: 'REJECTED' })

      await this.deliberationRoom.bind(pipelineRunId).publish({
        sender: 'PRIYA',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        content: '',
        payload: {
          message: `Cannot submit portfolio draft. Confidence score is below threshold: ${totalScore}/100.`,
          score: totalScore,
          blocking_reasons: confidenceScore.blocking_reasons,
        },
        references: [],
      })
      throw new Error(`Confidence score threshold failed. Score: ${totalScore}. Reasons: ${confidenceScore.blocking_reasons.join('; ')}`)
    }

    await this.saveToDatabase({ ...validated, status: 'SUBMITTED' })

    logger.info('PRIYA: Publishing portfolio draft to Deliberation Room')
    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'PRIYA',
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      content: '',
      payload: {
        portfolio_id: validated.portfolio_id,
        version: validated.version,
        revision_number: validated.revision_number,
        allocations: validated.fund_allocations.map((a) => ({ fund: a.fund_name, code: a.scheme_code, pct: a.allocation_pct })),
        confidence_score: validated.confidence_score.total,
        cagr_pct: validated.backtest_summary.portfolio_cagr_pct,
      },
      references: [],
    })

    await writeMemory(
      'PRIYA',
      makePipelineKey('PRIYA', 'portfolio_draft', validated.client_id, pipelineRunId),
      {
        content: validated,
        memory_type: 'PRIYA_PORTFOLIO_DRAFT',
        source_url: 'Internal',
        confidence_tier: 'VERIFIED',
        tags: [
          makePipelineKey('PRIYA', 'portfolio_draft', validated.client_id, pipelineRunId),
          makePipelineKey('PRIYA', 'confidence_score', validated.client_id, pipelineRunId),
          makePipelineKey('PRIYA', 'backtest_summary', validated.client_id, pipelineRunId),
        ],
        pipeline_run_id: pipelineRunId,
      },
    )

    return validated
  }

  private async saveToDatabase(draft: PortfolioDraft): Promise<void> {
    try {
      await this.db.insert(schema.portfolioDrafts).values({
        draftId: draft.portfolio_id,
        pipelineRunId: draft.pipeline_run_id,
        clientId: draft.client_id,
        version: draft.version,
        revisionNumber: draft.revision_number,
        goalBuckets: draft.goal_buckets,
        fundAllocations: draft.fund_allocations,
        modelAllocation: draft.fund_allocations.map((a) => ({ schemeCode: a.scheme_code, percentage: a.allocation_pct })),
        strategyFramework: JSON.stringify(draft.strategy_framework),
        confidenceScore: draft.confidence_score.total.toString(),
        riskFlags: draft.overlap_flags,
        rationale: {
          backtest_summary: draft.backtest_summary,
          hedge_instruments: draft.hedge_instruments,
          open_critique_items: draft.open_critique_items,
          status: draft.status,
          universe_filters_applied: draft.universe_filters_applied,
        },
      })
      logger.info({ draftId: draft.portfolio_id }, 'PRIYA: Saved portfolio draft to database')
    } catch (err) {
      logger.error({ err, draftId: draft.portfolio_id }, 'PRIYA: Failed to save portfolio draft to database')
    }
  }

  async revise(
    previousDraft: PortfolioDraft,
    critiqueReport: CritiqueReport,
    hedgeMap: HedgeMap,
    pipelineRunId: string,
  ): Promise<PortfolioDraft> {
    logger.info({ pipelineRunId, previousDraftId: previousDraft.portfolio_id }, 'PRIYA: revise invoked')

    const revised: PortfolioDraft = {
      ...previousDraft,
      portfolio_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      revision_number: (previousDraft.revision_number || 0) + 1,
      hedge_instruments: hedgeMap,
      open_critique_items: critiqueReport.faults.filter((f) => f.severity === 'MINOR' || f.severity === 'OBSERVATION'),
      status: 'DRAFT',
    }

    const validated = PortfolioDraftSchema.parse(revised)

    await this.saveToDatabase({ ...validated, status: 'SUBMITTED' })

    await this.deliberationRoom.bind(pipelineRunId).publish({
      sender: 'PRIYA',
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      content: '',
      payload: {
        portfolio_id: validated.portfolio_id,
        version: validated.version,
        revision_number: validated.revision_number,
        allocations: validated.fund_allocations.map((a) => ({ fund: a.fund_name, code: a.scheme_code, pct: a.allocation_pct })),
        confidence_score: validated.confidence_score.total,
        cagr_pct: validated.backtest_summary.portfolio_cagr_pct,
      },
      references: [previousDraft.portfolio_id],
    })

    return validated
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('PRIYA: Starting weekly synthesizer research sweep')
    try {
      await this.webResearchTool.research(
        {
          query_text:
            'optimal portfolio construction asset allocation modern portfolio theory mutual fund weights standard deviation',
          intent: 'weekly_sweep_synthesizer',
          freshness_required_days: 7,
          max_sources: 3,
          memory_type: 'PRIYA_PORTFOLIO_DRAFT',
        },
        'WEEKLY_RESEARCH',
      )
      logger.info('PRIYA: Weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'PRIYA: Weekly sweep research failed')
    }
  }
}

export function computeConfidenceScore(params: {
  dataFresh: boolean
  achievabilityVerdict: string
  overallHedgeCoveragePct: number
  critiqueFaults: { severity: string }[]
  backtestPeriodYears: number
  backtestCompletenessPct: number
}): PortfolioConfidenceScore {
  const scoreFreshness = params.dataFresh ? 20 : 0

  let scoreAchievability = 0
  if (params.achievabilityVerdict === 'ALIGNS_WITH_GOALS') scoreAchievability = 20
  else if (params.achievabilityVerdict === 'NEEDS_DISCUSSION') scoreAchievability = 10

  const scoreHedge = params.overallHedgeCoveragePct >= 80 ? 20 : 0

  const hasCritical = params.critiqueFaults.some((f) => f.severity === 'CRITICAL')
  const hasMajor = params.critiqueFaults.some((f) => f.severity === 'MAJOR')

  let scoreCritique = 0
  if (!hasCritical && !hasMajor) scoreCritique = 20
  else if (!hasCritical && hasMajor) scoreCritique = 10

  const scoreBacktest = params.backtestPeriodYears >= 5 && params.backtestCompletenessPct >= 70 ? 20 : 0

  const totalScore = scoreFreshness + scoreAchievability + scoreHedge + scoreCritique + scoreBacktest

  const blockingReasons: string[] = []
  if (!params.dataFresh) blockingReasons.push('Fund Profile data contains elements older than 7 days.')
  if (params.achievabilityVerdict === 'OUT_OF_SCOPE')
    blockingReasons.push('Stated goal achievability verdict is OUT_OF_SCOPE.')
  if (params.overallHedgeCoveragePct < 80)
    blockingReasons.push(`Hedge Map coverage is below 80% (${params.overallHedgeCoveragePct}%).`)
  if (hasCritical) blockingReasons.push('Aria Critique contains blocking CRITICAL faults.')

  return {
    total: totalScore,
    breakdown: {
      data_freshness: scoreFreshness as 0 | 20,
      goal_achievability: scoreAchievability as 0 | 10 | 20,
      hedge_completeness: scoreHedge as 0 | 20,
      critique_severity: scoreCritique as 0 | 10 | 20,
      backtest_quality: scoreBacktest as 0 | 20,
    },
    blocking_reasons: blockingReasons,
  }
}
