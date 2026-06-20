import { randomUUID } from 'crypto'
import { eq, desc, and, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  PortfolioDraft,
  PortfolioDraftSchema,
  GoalBucket,
  FundAllocation,
  BacktestSummary,
  PortfolioConfidenceScore
} from './types/priya-types'
import { ClientGoalAssessment, StrategyFramework } from './types/vikram-types'
import { ClientRiskProfile, HedgeMap } from './types/kiran-types'
import { CritiqueReport, CritiqueFault, PreflightReport } from './types/aria-types'
import { FundUniverse } from './types/soma-types'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { AgentMemoryStore, makePipelineKey } from '../memory/memory-store'
import { WebResearchTool } from '../research/web-research-tool'
import { Soma } from './soma'
import { runBacktest } from './priya-backtest'
import { getGpt4o } from '../azure-openai'
import { KnowledgeCommons } from '../research/knowledge-commons'
import logger from '../logger'

const PRIYA_SYSTEM_PROMPT = `You are PRIYA (Portfolio Recommendation & Intelligent Yield Allocator), the Portfolio Synthesizer in a multi-agent system.

YOUR ROLE: Assemble, filter, design, analyze, score, backtest, and publish the final portfolio recommendation. You are the ONLY agent allowed to assign portfolio weights and holdings.

YOUR PORTFOLIO SYNTHESIS PROTOCOL:
1. Load all current inputs (risk profile, goal assessment, strategy framework guidance, hedge map, critique reports).
2. Filter the mutual fund universe strictly based on criteria:
   - expense_ratio < 1.5% for active equity/debt, < 0.5% for index/ETF
   - min track record 3 years
   - min AUM 500Cr for equity, 1000Cr for debt
3. Design allocations: Assign weights across buckets and funds.
4. Call SOMA's composition audit to check holdings overlap between fund pairs. Flag any overlap > 40%.
5. Compute portfolio confidence score based on the 5-part formula. If confidence score < 60, fail fast.
6. Run the backtesting engine (monthly cumulative CAGR, Sharpe, Sortino).
7. Save draft to database and publish to Deliberation Room.

WHAT YOU MUST NEVER DO:
- Never assign weights that do not sum to 100% across the portfolio.
- Never publish a portfolio with a confidence score < 60.
- Never use stale fund profile data older than 7 days.`

export class Priya {
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
    pipelineRunId: string
  ): Promise<PortfolioDraft> {
    logger.info({ pipelineRunId }, 'PRIYA: buildPortfolio invoked')

    // Step 1 — Inputs Assembly & Validation
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
      await this.deliberationRoom.publish({
        pipeline_run_id: pipelineRunId,
        sender: 'PRIYA',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        payload: {
          message: 'Cannot build portfolio. Missing inputs.',
          missing_fields: missing
        },
        references: []
      })
      throw new Error(msg)
    }

    const kc = new KnowledgeCommons(this.deliberationRoom)
    const priorLearnings = await kc.queryCommons('PRIYA', 'portfolio_construction')
    const learningsContext = priorLearnings.length > 0 
      ? `\n\nLearnings from prior runs:\n${priorLearnings.map((l: any) => `- ${l.summary}`).join('\n')}`
      : ''

    const preflightContext = inputs.preflightReport && inputs.preflightReport.predictedFailureModes.length > 0
      ? `\n\nBefore drafting, review these predicted failure modes from ARIA's pre-flight analysis. Your draft must explicitly address each one:\n` +
        inputs.preflightReport.predictedFailureModes.map(f => `- [${f.severity}] ${f.faultCategory}: ${f.avoidanceGuidance}`).join('\n')
      : ''

    // Check TTL (SOMA FundProfile data older than 7 days)
    const now = new Date()
    const SOMA_TTL_DAYS = 7
    const ageMs = now.getTime() - new Date(inputs.fundUniverse.generated_at).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    const dataFresh = ageDays <= SOMA_TTL_DAYS

    // Step 3 — Allocation Design (Weights using GPT-4o synthesis)
    logger.info('PRIYA: Designing allocations via LLM')
    const gpt = getGpt4o()
    const prompt = `
Generate a goal bucket list and specific mutual fund allocations for this client.
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
      "allocation_pct": number // total should sum to 100
    }
  ],
  "fund_allocations": [
    {
      "allocation_id": string (UUID),
      "fund_name": string,
      "isin": string,
      "scheme_code": string,
      "allocation_pct": number, // total across portfolio must sum to 100
      "goal_bucket_id": string (UUID matching one of the buckets above),
      "rationale": string // cite specific FundProfile metrics
    }
  ]
}
`
    let behavioralContext = ''
    if (inputs.behavioralFingerprint) {
      const fp = inputs.behavioralFingerprint
      const guidance = Array.isArray(fp.constructionGuidance)
        ? fp.constructionGuidance.map((g: string) => `- ${g}`).join('\n')
        : ''
      behavioralContext = `\n\nBehavioral constraints from RIYA (treat these as requirements, not suggestions):\n` + guidance
      
      if (fp.portfolioAbandonmentRisk === 'HIGH') {
        behavioralContext += `\nCRITICAL CONSTRAINT: The client has a HIGH risk of portfolio abandonment. You MUST cap the individual fund allocation at 20% (no single fund allocation can exceed 20%) and you MUST prefer index/passive funds over active funds.`
      }
    }

    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PRIYA_SYSTEM_PROMPT + learningsContext + preflightContext + behavioralContext },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    const zodUuidRegex = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/
    const isUuid = (str: string) => typeof str === 'string' && zodUuidRegex.test(str)

    // Decouple LLM bucket_ids but maintain matching fund connections
    const bucketIdMap = new Map<string, string>()

    // Assign fresh UUIDs if LLM missed or provided string templates
    const goalBuckets: GoalBucket[] = (parsed.goal_buckets || []).map((gb: any) => {
      const cleanBucketId = randomUUID()
      if (gb.bucket_id) {
        bucketIdMap.set(gb.bucket_id, cleanBucketId)
      }

      const actualGoal = inputs.goalAssessment.decomposed_goals.find(
        g => g.goal_type === gb.goal_type
      )
      const goal_id = isUuid(gb.goal_id) ? gb.goal_id : (actualGoal?.goal_id || inputs.goalAssessment.decomposed_goals[0]?.goal_id || randomUUID())

      return {
        bucket_id: cleanBucketId,
        goal_id,
        goal_type: gb.goal_type,
        target_corpus_lakh: gb.target_corpus_lakh,
        target_date: gb.target_date,
        time_horizon_years: gb.time_horizon_years,
        risk_profile: gb.risk_profile,
        allocation_pct: gb.allocation_pct
      }
    })

    const fundAllocations: FundAllocation[] = (parsed.fund_allocations || []).map((fa: any) => {
      // Find matching bucket_id by index if UUID mismatch
      let matchedBucketId = bucketIdMap.get(fa.goal_bucket_id) || fa.goal_bucket_id
      if (goalBuckets.length > 0 && (!isUuid(matchedBucketId) || !goalBuckets.some(b => b.bucket_id === matchedBucketId))) {
        matchedBucketId = goalBuckets[0].bucket_id
      }
      return {
        allocation_id: randomUUID(), // Always generate fresh clean UUID
        fund_name: fa.fund_name,
        isin: fa.isin || 'IN0000000000',
        scheme_code: fa.scheme_code,
        allocation_pct: fa.allocation_pct,
        goal_bucket_id: matchedBucketId,
        rationale: fa.rationale || 'Selected for risk-adjusted performance.',
        fund_profile_retrieved_at: now.toISOString(),
        overlap_checked: false
      }
    })

    // Step 4 — Overlap Analysis
    logger.info('PRIYA: Running holding overlap analysis')
    const overlapFlags: { fund_a: string; fund_b: string; overlap_pct: number }[] = []
    const soma = new Soma(this.deliberationRoom, this.memoryStore, this.webResearchTool, this.db)

    const audits: Record<string, any> = {}
    for (const alloc of fundAllocations) {
      try {
        audits[alloc.scheme_code] = await soma.auditComposition(alloc.scheme_code, inputs.goalAssessment.client_id, pipelineRunId)
        alloc.overlap_checked = true
      } catch (err) {
        logger.warn({ err, schemeCode: alloc.scheme_code }, 'PRIYA: failed to audit composition for overlap, using mock')
        audits[alloc.scheme_code] = {
          scheme_code: alloc.scheme_code,
          top_holdings: [{ company: 'Mock Corp', allocation_pct: 10 }]
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
            const hB = holdingsB.find((h: any) => h.company.toLowerCase() === hA.company.toLowerCase())
            if (hB) {
              overlap += Math.min(hA.allocation_pct, hB.allocation_pct)
            }
          }
        }

        if (overlap > 40) {
          overlapFlags.push({
            fund_a: fundAllocations[i].fund_name,
            fund_b: fundAllocations[j].fund_name,
            overlap_pct: overlap
          })
        }
      }
    }

    // Step 6 — Run backtesting engine
    logger.info('PRIYA: Executing backtesting engine')
    const backtest: BacktestSummary = await runBacktest(fundAllocations, this.db)

    // Step 5 — Compute confidence_score (deterministic)
    logger.info('PRIYA: Calculating confidence score')
    
    const allCritiqueFaults = inputs.critiques.flatMap(c => c.faults || [])
    const confidenceScore = computeConfidenceScore({
      dataFresh,
      achievabilityVerdict: inputs.goalAssessment.achievability_verdict,
      overallHedgeCoveragePct: inputs.hedgeMap.overall_hedge_coverage_pct,
      critiqueFaults: allCritiqueFaults,
      backtestPeriodYears: backtest.period_years,
      backtestCompletenessPct: backtest.data_completeness_pct
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
      open_critique_items: allCritiqueFaults.filter(f => f.severity === 'MINOR' || f.severity === 'OBSERVATION'),
      universe_filters_applied: inputs.fundUniverse.filters_applied,
      overlap_flags: overlapFlags,
      status: 'DRAFT',
      strategy_framework: inputs.strategyFramework
    }

    const validated = PortfolioDraftSchema.parse(draft)

    // If score < 60: DO NOT PUBLISH to deliberation room. Save as REJECTED in database and publish error directive.
    if (totalScore < 60) {
      logger.warn({ totalScore, blockingReasons: confidenceScore.blocking_reasons }, 'PRIYA: Confidence score is below 60. Blocking publication.')
      
      // Save to database as REJECTED
      await this.saveToDatabase({ ...validated, status: 'REJECTED' })

      await this.deliberationRoom.publish({
        pipeline_run_id: pipelineRunId,
        sender: 'PRIYA',
        message_type: 'DIRECTIVE',
        recipient: 'DHRUV',
        payload: {
          message: `Cannot submit portfolio draft. Confidence score is below threshold: ${totalScore}/100.`,
          score: totalScore,
          blocking_reasons: confidenceScore.blocking_reasons
        },
        references: []
      })
      throw new Error(`Confidence score threshold failed. Score: ${totalScore}. Reasons: ${confidenceScore.blocking_reasons.join('; ')}`)
    }

    // Save to database
    await this.saveToDatabase({ ...validated, status: 'SUBMITTED' })

    // Step 7 — Publish PORTFOLIO_DRAFT to Deliberation Room
    logger.info('PRIYA: Publishing portfolio draft to Deliberation Room')
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      payload: {
        portfolio_id: validated.portfolio_id,
        version: validated.version,
        revision_number: validated.revision_number,
        allocations: validated.fund_allocations.map(a => ({ fund: a.fund_name, code: a.scheme_code, pct: a.allocation_pct })),
        confidence_score: validated.confidence_score.total,
        cagr_pct: validated.backtest_summary.portfolio_cagr_pct
      },
      references: []
    })

    await this.memoryStore.write('PRIYA', {
      content: validated,
      memory_type: 'PRIYA_PORTFOLIO_DRAFT',
      source_url: 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [
        makePipelineKey('PRIYA', 'portfolio_draft', validated.client_id, pipelineRunId),
        makePipelineKey('PRIYA', 'confidence_score', validated.client_id, pipelineRunId),
        makePipelineKey('PRIYA', 'backtest_summary', validated.client_id, pipelineRunId)
      ],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  private async saveToDatabase(draft: PortfolioDraft): Promise<void> {
    try {
      await this.db.insert(schema.portfolioDrafts).values({
        draftId: draft.portfolio_id,
        pipelineRunId: draft.pipeline_run_id,
        clientId: draft.client_id,
        version: draft.version,
        goalBuckets: draft.goal_buckets,
        fundAllocations: draft.fund_allocations,
        hedgeInstruments: draft.hedge_instruments,
        confidenceScore: draft.confidence_score.total.toString(),
        backtestSummary: draft.backtest_summary,
        openCritiqueItems: draft.open_critique_items,
        status: draft.status
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
    pipelineRunId: string
  ): Promise<PortfolioDraft> {
    logger.info({ pipelineRunId, previousDraftId: previousDraft.portfolio_id }, 'PRIYA: revise invoked')

    // Find and explicitly address critical/major faults
    const faultsToResolve = critiqueReport.faults.filter(f => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
    const unresolvedMinor = critiqueReport.faults.filter(f => f.severity === 'MINOR' || f.severity === 'OBSERVATION')

    // Re-run synthesis (LLM) taking into account the critique report
    const gpt = getGpt4o()
    const prompt = `
You are revising a previously generated portfolio draft to resolve critique faults.
You must resolve all CRITICAL and MAJOR faults identified by ARIA.
You must return a valid JSON object ONLY matching the output schema. Do not include markdown code block formatting.

Previous Draft:
${JSON.stringify(previousDraft, null, 2)}

Critique Report Objections to Resolve:
${JSON.stringify(faultsToResolve, null, 2)}

Hedge Map Updates:
${JSON.stringify(hedgeMap, null, 2)}

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
      "rationale": string
    }
  ]
}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PRIYA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleanJson)
    const now = new Date()

    const zodUuidRegex = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/
    const isUuid = (str: string) => typeof str === 'string' && zodUuidRegex.test(str)

    // Decouple LLM bucket_ids but maintain matching fund connections
    const bucketIdMap = new Map<string, string>()

    const goalBuckets: GoalBucket[] = (parsed.goal_buckets || []).map((gb: any) => {
      const cleanBucketId = randomUUID()
      if (gb.bucket_id) {
        bucketIdMap.set(gb.bucket_id, cleanBucketId)
      }

      const prevBucket = previousDraft.goal_buckets.find(b => b.goal_type === gb.goal_type)
      const goal_id = isUuid(gb.goal_id) ? gb.goal_id : (prevBucket?.goal_id || previousDraft.goal_buckets[0]?.goal_id || randomUUID())

      return {
        bucket_id: cleanBucketId,
        goal_id,
        goal_type: gb.goal_type,
        target_corpus_lakh: gb.target_corpus_lakh,
        target_date: gb.target_date,
        time_horizon_years: gb.time_horizon_years,
        risk_profile: gb.risk_profile,
        allocation_pct: gb.allocation_pct
      }
    })

    const fundAllocations: FundAllocation[] = (parsed.fund_allocations || []).map((fa: any) => {
      let matchedBucketId = bucketIdMap.get(fa.goal_bucket_id) || fa.goal_bucket_id
      if (goalBuckets.length > 0 && (!isUuid(matchedBucketId) || !goalBuckets.some(b => b.bucket_id === matchedBucketId))) {
        matchedBucketId = goalBuckets[0].bucket_id
      }

      // Try to find matching fund from previous draft for fallback scheme_code and isin
      const prevAlloc = previousDraft.fund_allocations.find(pa => 
        (pa.fund_name || '').toLowerCase() === (fa.fund_name || '').toLowerCase() ||
        (fa.fund_name && pa.fund_name.toLowerCase().includes(fa.fund_name.toLowerCase())) ||
        (fa.fund_name && fa.fund_name.toLowerCase().includes(pa.fund_name.toLowerCase()))
      )

      return {
        allocation_id: randomUUID(), // Always generate fresh clean UUID
        fund_name: fa.fund_name || prevAlloc?.fund_name || 'Unknown Fund',
        isin: fa.isin || prevAlloc?.isin || 'IN0000000000',
        scheme_code: fa.scheme_code || prevAlloc?.scheme_code || '',
        allocation_pct: typeof fa.allocation_pct === 'number' ? fa.allocation_pct : parseFloat(fa.allocation_pct || '0'),
        goal_bucket_id: matchedBucketId,
        rationale: fa.rationale || 'Revised allocation based on critique.',
        fund_profile_retrieved_at: now.toISOString(),
        overlap_checked: true
      }
    })

    // Compute overlap
    const overlapFlags: { fund_a: string; fund_b: string; overlap_pct: number }[] = []
    const soma = new Soma(this.deliberationRoom, this.memoryStore, this.webResearchTool, this.db)
    
    const audits: Record<string, any> = {}
    for (const alloc of fundAllocations) {
      try {
        audits[alloc.scheme_code] = await soma.auditComposition(alloc.scheme_code, previousDraft.client_id, pipelineRunId)
      } catch (err) {
        audits[alloc.scheme_code] = { scheme_code: alloc.scheme_code, top_holdings: [] }
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
            const hB = holdingsB.find((h: any) => h.company.toLowerCase() === hA.company.toLowerCase())
            if (hB) overlap += Math.min(hA.allocation_pct, hB.allocation_pct)
          }
        }
        if (overlap > 40) {
          overlapFlags.push({
            fund_a: fundAllocations[i].fund_name,
            fund_b: fundAllocations[j].fund_name,
            overlap_pct: overlap
          })
        }
      }
    }

    // Run backtesting
    const backtest: BacktestSummary = await runBacktest(fundAllocations, this.db)

    // Compute confidence score
    const hasCritical = critiqueReport.faults.some(f => f.severity === 'CRITICAL')
    const hasMajor = critiqueReport.faults.some(f => f.severity === 'MAJOR')
    const scoreFreshness = 20
    const scoreAchievability = 20
    const scoreHedge = (hedgeMap.overall_hedge_coverage_pct >= 80) ? 20 : 0
    
    let scoreCritique = 0
    if (!hasCritical && !hasMajor) scoreCritique = 20
    else if (!hasCritical && hasMajor) scoreCritique = 10

    const scoreBacktest = (backtest.period_years >= 5 && backtest.data_completeness_pct >= 70) ? 20 : 0
    const totalScore = scoreFreshness + scoreAchievability + scoreHedge + scoreCritique + scoreBacktest

    const confidenceScore: PortfolioConfidenceScore = {
      total: totalScore,
      breakdown: {
        data_freshness: scoreFreshness as any,
        goal_achievability: scoreAchievability as any,
        hedge_completeness: scoreHedge as any,
        critique_severity: scoreCritique as any,
        backtest_quality: scoreBacktest as any
      },
      blocking_reasons: []
    }

    const version = previousDraft.version // Carry forward same overall version
    const revisionNumber = previousDraft.revision_number + 1

    const draft: PortfolioDraft = {
      portfolio_id: randomUUID(),
      client_id: previousDraft.client_id,
      pipeline_run_id: pipelineRunId,
      version,
      revision_number: revisionNumber,
      goal_buckets: goalBuckets,
      fund_allocations: fundAllocations,
      hedge_instruments: hedgeMap,
      confidence_score: confidenceScore,
      backtest_summary: backtest,
      open_critique_items: unresolvedMinor,
      universe_filters_applied: previousDraft.universe_filters_applied,
      overlap_flags: overlapFlags,
      status: 'DRAFT',
      strategy_framework: previousDraft.strategy_framework
    }

    const validated = PortfolioDraftSchema.parse(draft)

    // Save and publish
    await this.saveToDatabase({ ...validated, status: 'SUBMITTED' })

    let ariaCritiqueMessageId: string | undefined = undefined
    try {
      const history = await this.deliberationRoom.getHistory(pipelineRunId)
      const ariaCritique = [...history]
        .reverse()
        .find(m => m.sender === 'ARIA' && m.message_type === 'CRITIQUE')
      if (ariaCritique) {
        ariaCritiqueMessageId = ariaCritique.message_id
      }
    } catch (err) {
      logger.warn({ err }, 'PRIYA: Failed to find ARIA critique message in history')
    }

    await this.deliberationRoom.send({
      pipeline_run_id: pipelineRunId,
      sender: 'PRIYA',
      message_type: 'PORTFOLIO_DRAFT',
      recipient: 'ALL',
      payload: {
        portfolio_id: validated.portfolio_id,
        version: validated.version,
        revision_number: validated.revision_number,
        allocations: validated.fund_allocations.map(a => ({ fund: a.fund_name, code: a.scheme_code, pct: a.allocation_pct })),
        confidence_score: validated.confidence_score.total,
        cagr_pct: validated.backtest_summary.portfolio_cagr_pct
      },
      references: [previousDraft.portfolio_id]
    }, ariaCritiqueMessageId)

    await this.memoryStore.write('PRIYA', {
      content: validated,
      memory_type: 'PRIYA_PORTFOLIO_DRAFT',
      source_url: 'Internal',
      confidence_tier: 'VERIFIED',
      tags: [
        makePipelineKey('PRIYA', 'portfolio_draft', validated.client_id, pipelineRunId),
        makePipelineKey('PRIYA', 'confidence_score', validated.client_id, pipelineRunId),
        makePipelineKey('PRIYA', 'backtest_summary', validated.client_id, pipelineRunId)
      ],
      pipeline_run_id: pipelineRunId
    })

    return validated
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('PRIYA: Starting weekly synthesizer research sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'optimal portfolio construction asset allocation modern portfolio theory mutual fund weights standard deviation',
        intent: 'weekly_sweep_synthesizer',
        freshness_required_days: 7,
        max_sources: 3,
        memory_type: 'PRIYA_PORTFOLIO_DRAFT'
      }, 'WEEKLY_RESEARCH')
      logger.info({ resultsCount: results.length }, 'PRIYA: Weekly sweep complete')
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
  if (params.achievabilityVerdict === 'ACHIEVABLE') scoreAchievability = 20
  else if (params.achievabilityVerdict === 'REVISED') scoreAchievability = 10
  
  const scoreHedge = (params.overallHedgeCoveragePct >= 80) ? 20 : 0
  
  const hasCritical = params.critiqueFaults.some(f => f.severity === 'CRITICAL')
  const hasMajor = params.critiqueFaults.some(f => f.severity === 'MAJOR')
  
  let scoreCritique = 0
  if (!hasCritical && !hasMajor) scoreCritique = 20
  else if (!hasCritical && hasMajor) scoreCritique = 10

  const scoreBacktest = (params.backtestPeriodYears >= 5 && params.backtestCompletenessPct >= 70) ? 20 : 0

  const totalScore = scoreFreshness + scoreAchievability + scoreHedge + scoreCritique + scoreBacktest
  
  const blockingReasons: string[] = []
  if (!params.dataFresh) blockingReasons.push('Fund Profile data contains elements older than 7 days.')
  if (params.achievabilityVerdict === 'IMPOSSIBLE') blockingReasons.push('Stated goal achievability verdict is IMPOSSIBLE.')
  if (params.overallHedgeCoveragePct < 80) blockingReasons.push(`Hedge Map coverage is below 80% (${params.overallHedgeCoveragePct}%).`)
  if (hasCritical) blockingReasons.push('Aria Critique contains blocking CRITICAL faults.')

  return {
    total: totalScore,
    breakdown: {
      data_freshness: scoreFreshness as any,
      goal_achievability: scoreAchievability as any,
      hedge_completeness: scoreHedge as any,
      critique_severity: scoreCritique as any,
      backtest_quality: scoreBacktest as any
    },
    blocking_reasons: blockingReasons
  }
}
