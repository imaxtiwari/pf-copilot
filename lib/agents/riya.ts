import { eq, desc, asc, inArray } from 'drizzle-orm'
import { getGpt4oMini } from '../azure-openai'
import * as schema from '../../db/schema'
import { RIYA_SYSTEM_PROMPT } from '../prompts/riya-behavioral'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { qdrant } from '../memory/memory-store'
import { Soma } from './soma'
import logger from '../logger'

export interface BehavioralPattern {
  patternType:
    | 'RECENCY_CHASING'
    | 'WINNER_CONCENTRATION'
    | 'OVER_DIVERSIFICATION'
    | 'LOSS_AVERSION'
    | 'ANCHORING_BIAS'
    | 'OVER_CONFIDENCE'
    | 'INERTIA'
    | 'PANIC_SIGNALS'
    | 'PLAN_DEVIATION'
    | 'SIP_DISCIPLINE'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  evidence: string
  implication: string
}

export interface BehavioralFingerprint {
  patterns: BehavioralPattern[]
  riskToleranceReality: 'LOWER_THAN_STATED' | 'MATCHES_STATED' | 'HIGHER_THAN_STATED'
  riskToleranceReasoning: string
  portfolioAbandonmentRisk: 'HIGH' | 'MEDIUM' | 'LOW'
  abandonmentRiskReasoning: string
  constructionGuidance: string[]
}

export class Riya {
  constructor(
    private deliberationRoom: any,
    private memoryStore: any,
    private webResearchTool: any,
    private db: any
  ) {}

  async getCachedFingerprint(userId: string): Promise<BehavioralFingerprint | null> {
    try {
      const collectionName = 'agent_memory_riya'
      const res = await qdrant.scroll(collectionName, {
        limit: 100,
        with_payload: true
      })
      const targetTag = `riya:behavioral_fingerprint:${userId}`
      for (const point of res.points || []) {
        const payload = point.payload as any
        if (payload && payload.tags && payload.tags.includes(targetTag)) {
          const ageMs = Date.now() - new Date(payload.created_at).getTime()
          const ageDays = ageMs / (1000 * 60 * 60 * 24)
          if (ageDays < 30 && payload.status === 'ACTIVE') {
            logger.info({ userId }, 'RIYA: Cache hit from Qdrant memory')
            return JSON.parse(payload.content) as BehavioralFingerprint
          }
        }
      }
    } catch (err) {
      logger.warn({ err, userId }, 'RIYA: Failed to check Qdrant cache')
    }
    return null
  }

  async getDatabaseFingerprint(userId: string, pipelineRunId: string): Promise<BehavioralFingerprint | null> {
    try {
      const [existing] = await this.db
        .select()
        .from(schema.behavioralFingerprints)
        .where(eq(schema.behavioralFingerprints.pipelineRunId, pipelineRunId))
        .limit(1)
      if (existing) {
        return existing.fingerprint as BehavioralFingerprint
      }
    } catch (err) {
      logger.warn({ err, userId }, 'RIYA: Failed to check database fingerprint')
    }
    return null
  }

  async saveToDatabase(userId: string, pipelineRunId: string, fingerprint: BehavioralFingerprint): Promise<void> {
    try {
      await this.db
        .insert(schema.behavioralFingerprints)
        .values({
          userId,
          pipelineRunId,
          fingerprint,
          patternsDetected: fingerprint.patterns?.length || 0,
          abandonmentRisk: fingerprint.portfolioAbandonmentRisk,
          generatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.behavioralFingerprints.pipelineRunId,
          set: {
            fingerprint,
            patternsDetected: fingerprint.patterns?.length || 0,
            abandonmentRisk: fingerprint.portfolioAbandonmentRisk,
            generatedAt: new Date()
          }
        })
    } catch (err) {
      logger.error({ err, userId, pipelineRunId }, 'RIYA: Failed to save fingerprint to DB')
    }
  }

  async getOrGenerateFingerprint(
    userId: string,
    pipelineRunId: string,
    goalHypothesisCorrections: string[],
    driftReport?: any
  ): Promise<BehavioralFingerprint> {
    const dbFp = await this.getDatabaseFingerprint(userId, pipelineRunId)
    if (dbFp) {
      if (goalHypothesisCorrections.length === 0) {
        return dbFp
      }
    }

    const cached = await this.getCachedFingerprint(userId)
    if (cached) {
      if (goalHypothesisCorrections.length === 0) {
        auditTrail.log({
          pipeline_run_id: pipelineRunId,
          agent_id: 'RIYA',
          action_type: AuditActionType.RIYA_PROFILING_COMPLETE as any,
          payload: {
            patterns_detected: cached.patterns?.length || 0,
            abandonment_risk: cached.portfolioAbandonmentRisk,
            cache_hit: true
          }
        })

        await this.saveToDatabase(userId, pipelineRunId, cached)
        return cached
      }
    }

    let drift = driftReport
    if (!drift) {
      try {
        const [latestDrift] = await this.db
          .select()
          .from(schema.driftReports)
          .where(eq(schema.driftReports.userId, userId))
          .orderBy(desc(schema.driftReports.generatedAt))
          .limit(1)
        if (latestDrift) {
          drift = latestDrift.report
        }
      } catch (err) {
        logger.warn({ err, userId }, 'RIYA: Failed to fetch latest drift report from DB')
      }
    }

    const existingHoldings = await this.db
      .select()
      .from(schema.portfolioHoldings)
      .where(eq(schema.portfolioHoldings.userId, userId))

    const schemeCodes = new Set<string>()
    existingHoldings.forEach((h: any) => { if (h.schemeCode) schemeCodes.add(h.schemeCode) })

    const fundSnapshots = schemeCodes.size > 0
      ? await this.db
          .select()
          .from(schema.fundSnapshots)
          .where(inArray(schema.fundSnapshots.schemeCode, Array.from(schemeCodes)))
      : []

    const chatHistory = await this.db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.userId, userId))
      .orderBy(asc(schema.chatMessages.ts))

    return this.generateFingerprint(
      userId,
      pipelineRunId,
      existingHoldings,
      fundSnapshots,
      chatHistory,
      goalHypothesisCorrections,
      drift
    )
  }

  async generateFingerprint(
    userId: string,
    pipelineRunId: string,
    existingHoldings: any[],
    fundSnapshots: any[],
    chatHistory: any[],
    goalHypothesisCorrections: string[],
    driftReport?: any
  ): Promise<BehavioralFingerprint> {
    logger.info({ userId, pipelineRunId }, 'RIYA: Executing behavioral analysis')

    // Heuristics calculation
    let top10SchemeCodes = new Set<string>()
    try {
      const allSnaps = await this.db
        .select()
        .from(schema.fundSnapshots)

      const latestSnapshotPerScheme = new Map<string, any>()
      for (const snap of allSnaps) {
        const code = snap.schemeCode
        if (!code) continue
        const existing = latestSnapshotPerScheme.get(code)
        if (!existing || new Date(snap.snapshotDate) > new Date(existing.snapshotDate)) {
          latestSnapshotPerScheme.set(code, snap)
        }
      }

      const sortedBy1y = Array.from(latestSnapshotPerScheme.values()).sort((a: any, b: any) => {
        return parseFloat(b.return1y || '0') - parseFloat(a.return1y || '0')
      })

      sortedBy1y.slice(0, 10).forEach((s: any) => {
        if (s.schemeCode) top10SchemeCodes.add(s.schemeCode)
      })
    } catch (e) {
      logger.warn(e, 'RIYA: Failed to calculate top-10 return charts')
    }

    const recencyChasingFact = existingHoldings.some((h: any) => h.schemeCode && top10SchemeCodes.has(h.schemeCode))

    const totalCurrentValue = existingHoldings.reduce((sum, h) => sum + parseFloat(h.marketValue || '0'), 0)
    let winnerConcentrationValue = 0

    const userSnapshotMap = new Map<string, any>()
    for (const snap of fundSnapshots) {
      const code = snap.schemeCode || snap.scheme_code
      if (code) {
        const existing = userSnapshotMap.get(code)
        const snapDate = snap.snapshotDate || snap.snapshot_date
        const existingDate = existing ? (existing.snapshotDate || existing.snapshot_date) : null
        if (!existing || (snapDate && existingDate && new Date(snapDate) > new Date(existingDate))) {
          userSnapshotMap.set(code, snap)
        }
      }
    }

    for (const h of existingHoldings) {
      const snap = h.schemeCode ? userSnapshotMap.get(h.schemeCode) : null
      const return1y = snap ? parseFloat(snap.return1y || snap.return_1y || '0') : 0
      if (return1y > 20) {
        winnerConcentrationValue += parseFloat(h.marketValue || '0')
      }
    }
    const winnerConcentrationPct = totalCurrentValue > 0 ? (winnerConcentrationValue / totalCurrentValue) * 100 : 0
    const winnerConcentrationFact = winnerConcentrationPct > 30

    const soma = new Soma(this.deliberationRoom, this.memoryStore, this.webResearchTool, this.db)
    const audits: Record<string, any> = {}
    for (const alloc of existingHoldings) {
      const code = alloc.schemeCode
      if (!code) continue
      try {
        audits[code] = await soma.auditComposition(code, userId, pipelineRunId)
      } catch (err) {
        audits[code] = { scheme_code: code, top_holdings: [] }
      }
    }

    let hasOverFiftyPercentOverlap = false
    const overlapPairs: string[] = []
    for (let i = 0; i < existingHoldings.length; i++) {
      for (let j = i + 1; j < existingHoldings.length; j++) {
        const codeA = existingHoldings[i].schemeCode
        const codeB = existingHoldings[j].schemeCode
        if (!codeA || !codeB) continue
        const auditA = audits[codeA]
        const auditB = audits[codeB]

        let overlap = 0
        if (auditA && auditB) {
          const holdingsA = auditA.top_holdings || []
          const holdingsB = auditB.top_holdings || []

          for (const hA of holdingsA) {
            const hB = holdingsB.find((h: any) => h.company.toLowerCase() === hA.company.toLowerCase())
            if (hB) {
              overlap += Math.min(parseFloat(hA.allocation_pct || hA.allocationPct || '0'), parseFloat(hB.allocation_pct || hB.allocationPct || '0'))
            }
          }
        }

        if (overlap > 50) {
          hasOverFiftyPercentOverlap = true
          overlapPairs.push(`${existingHoldings[i].schemeName} and ${existingHoldings[j].schemeName} (${overlap.toFixed(1)}% overlap)`)
        }
      }
    }
    const overDiversificationFact = existingHoldings.length > 6 && hasOverFiftyPercentOverlap

    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
    let lossAversionFact = false
    const lossAverseFunds: string[] = []

    for (const h of existingHoldings) {
      const purchase = h.purchaseDate ? new Date(h.purchaseDate) : null
      const heldOver2Years = purchase ? purchase <= twoYearsAgo : false
      const snap = h.schemeCode ? userSnapshotMap.get(h.schemeCode) : null
      const alpha3y = snap ? parseFloat(snap.alpha3y || snap.alpha_3y || '0') : 0
      if (heldOver2Years && alpha3y < 0) {
        lossAversionFact = true
        lossAverseFunds.push(h.schemeName)
      }
    }

    let anchoringBiasFact = false
    const lowerCorrections = goalHypothesisCorrections.map(c => c.toLowerCase())
    const raisedCorpus = lowerCorrections.some(c => c.includes('corpus') || c.includes('target') || c.includes('increase') || c.includes('raise'))
    const raisedSipOrTimeline = lowerCorrections.some(c => c.includes('sip') || c.includes('timeline') || c.includes('year') || c.includes('date') || c.includes('extend'))
    if (raisedCorpus && !raisedSipOrTimeline) {
      anchoringBiasFact = true
    }

    let statedRiskIsAggressive = false
    try {
      const recalled = await this.memoryStore.recall('KIRAN', 'stated risk tolerance', { limit: 1, pipeline_run_id: pipelineRunId })
      if (recalled.length > 0 && recalled[0].content.toLowerCase().includes('high')) {
        statedRiskIsAggressive = true
      }
    } catch (e) {}

    const anxietyKeywords = ['worried', 'scared', 'losing', 'down', 'crash', 'fall', 'anxious', 'fear', 'loss']
    const hasAnxietyInChat = chatHistory.some((m: any) => {
      if (m.role !== 'user') return false
      const content = (m.content || '').toLowerCase()
      return anxietyKeywords.some(w => content.includes(w))
    })
    const overConfidenceFact = statedRiskIsAggressive && hasAnxietyInChat

    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const inertiaFact = existingHoldings.length > 0 && existingHoldings.every((h: any) => {
      const txDate = h.lastTransactionDate ? new Date(h.lastTransactionDate) : h.purchaseDate ? new Date(h.purchaseDate) : null
      return txDate ? txDate <= twentyFourMonthsAgo : true
    })

    const panicFact = hasAnxietyInChat

    const factsContext = `
Calculated heuristics for the investor:
1. RECENCY_CHASING: ${recencyChasingFact ? 'TRUE (Holds top performing funds)' : 'FALSE'}
2. WINNER_CONCENTRATION: ${winnerConcentrationFact ? 'TRUE (Concentration of ' + winnerConcentrationPct.toFixed(1) + '% in funds with >20% 1y returns)' : 'FALSE'}
3. OVER_DIVERSIFICATION: ${overDiversificationFact ? 'TRUE (' + existingHoldings.length + ' funds held, with high overlap: ' + overlapPairs.join('; ') + ')' : 'FALSE'}
4. LOSS_AVERSION: ${lossAversionFact ? 'TRUE (Holds underperforming negative-alpha funds for >2 years: ' + lossAverseFunds.join(', ') + ')' : 'FALSE'}
5. ANCHORING_BIAS: ${anchoringBiasFact ? 'TRUE (Raised target corpus in corrections without raising SIP or extending timeline)' : 'FALSE'}
6. OVER_CONFIDENCE: ${overConfidenceFact ? 'TRUE (Stated aggressive risk tolerance but expressed anxiety or fear in chat)' : 'FALSE'}
7. INERTIA: ${inertiaFact ? 'TRUE (Portfolio has not been transacted in >24 months)' : 'FALSE'}
8. PANIC_SIGNALS: ${panicFact ? 'TRUE (Chat history contains worry/fear keywords)' : 'FALSE'}
`

    const userProfileText = `User holds ${existingHoldings.length} funds with total value ₹${totalCurrentValue.toLocaleString('en-IN')}.`

    let driftContext = 'No portfolio drift data available.\n'
    if (driftReport) {
      driftContext = `
Drift Analysis (Since last upload ${driftReport.daysBetweenUploads} days ago):
- Changes: New: ${driftReport.changes?.newPositions?.length || 0}, Exits: ${driftReport.changes?.exitedPositions?.length || 0}, Increased: ${driftReport.changes?.increased?.length || 0}, Decreased: ${driftReport.changes?.decreased?.length || 0}
- Portfolio return for the period: ${driftReport.portfolioReturn?.nominalReturn?.toFixed(2)}% (Annualized: ${driftReport.portfolioReturn?.annualizedReturn?.toFixed(2)}%)
- Detected SIPs: ${driftReport.sipDetection?.map((s: any) => `${s.schemeName} (Est. ₹${s.estimatedMonthlyAmount}/mo, Confidence: ${s.confidence})`).join(', ') || 'None'}
- Recommendation Drift: ${driftReport.driftFromRecommendation ? `Rebalancing Needed: ${driftReport.driftFromRecommendation.rebalancingNeeded ? 'YES' : 'NO'} (Urgency: ${driftReport.driftFromRecommendation.rebalancingUrgency})` : 'No recommended plan drift data'}
`
    }

    const prompt = `You are running a behavioral profiling for client ${userId} based on holdings, drift history, chat history, and goal corrections.
    
    Demographics/Context:
    ${userProfileText}

    Heuristics Context:
    ${factsContext}

    Drift Context:
    ${driftContext}

    Goal Corrections (Vikram Goal Hypothesis corrections):
    ${goalHypothesisCorrections.length > 0 ? goalHypothesisCorrections.map(c => `- ${c}`).join('\n') : 'None.'}

    Chat History snippet:
    ${chatHistory.map((m: any) => `[${m.role}]: ${m.content}`).slice(-20).join('\n')}

    Generate the BehavioralFingerprint following the schema. Return valid JSON only.`;

    const gpt = getGpt4oMini()
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RIYA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    })

    const rawText = response.choices[0]?.message?.content?.trim() || '{}'
    const fingerprint = JSON.parse(rawText) as BehavioralFingerprint

    // Write to DB
    await this.saveToDatabase(userId, pipelineRunId, fingerprint)

    // Write to Qdrant memory
    await this.memoryStore.write('RIYA', {
      content: JSON.stringify(fingerprint),
      memory_type: 'RIYA_BEHAVIORAL_FINGERPRINT' as any,
      source_url: 'Internal',
      confidence_tier: 'INFERRED',
      tags: [`riya:behavioral_fingerprint:${userId}`],
      pipeline_run_id: pipelineRunId
    })

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'RIYA',
      action_type: AuditActionType.RIYA_PROFILING_COMPLETE as any,
      payload: {
        patterns_detected: fingerprint.patterns?.length || 0,
        abandonment_risk: fingerprint.portfolioAbandonmentRisk,
        cache_hit: false
      }
    })

    return fingerprint
  }
}
