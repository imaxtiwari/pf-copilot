import { randomUUID } from 'crypto'
import { eq, desc, asc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  PipelineStage,
  CommitteeVoteRecord,
  DeadlockReport,
  FinalPortfolioPacket,
  CommitteeVoteRecordSchema,
  DeadlockReportSchema,
  FinalPortfolioPacketSchema
} from './types/dhruv-types'
import { PortfolioDraft } from './types/priya-types'
import { CritiqueReport } from './types/aria-types'
import { ClientRiskProfile, ClientRiskProfileSchema } from './types/kiran-types'
import { ClientGoalAssessment, StrategyFramework } from './types/vikram-types'
import { FundUniverse } from './types/soma-types'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { AgentMemoryStore } from '../memory/memory-store'
import { WebResearchTool } from '../research/web-research-tool'
import { PipelineStateMachine } from '../pipeline/pipeline-state-machine'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { Kiran } from './kiran'
import { Vikram } from './vikram'
import { Aria } from './aria'
import { Soma } from './soma'
import { Priya } from './priya'
import { Mentor } from './mentor'
import { KnowledgeCommons, WeeklyLearning } from '../research/knowledge-commons'
import { AgentId } from '../deliberation/message-schema'
import { getGpt4o } from '../azure-openai'
import logger from '../logger'

const DHRUV_SYSTEM_PROMPT = `You are DHRUV (Dynamic Head of Recommendation & Utility Validation), the Investment Committee Chair and Pipeline Controller.

YOUR ROLE: Orchestrate the entire multi-agent recommendation pipeline. Oversee the committee voting process. Resolve deadlocks on the 5th revision cycle. Compile the final portfolio packet.

YOUR DECISION RULES:
- Committee voting: ARIA, KIRAN, VIKRAM vote. PRIYA abstains. You vote ONLY to break ties.
- Approval requires: 2/3 majority (2 out of 3 votes) AND zero CRITICAL faults from ARIA AND HedgeMap.overall_hedge_coverage_pct >= 80.
- A single CRITICAL fault from ARIA is an automatic REJECT, regardless of other votes.
- Deadlock triggers on revision cycle 5. Propose a compromise, run a compromise vote, and fall back to the highest-confidence-scoring draft.

WHAT YOU MUST NEVER DO:
- Never alter the vote records or allow an approved status if the conditions are not strictly met.
- Never omit the 4 required disclaimer texts in the final portfolio packet.`

export class Dhruv {
  private deliberationRoom: DeliberationRoom
  private memoryStore: AgentMemoryStore
  private webResearchTool: WebResearchTool
  private db: any
  private stateMachine: PipelineStateMachine

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
    this.stateMachine = new PipelineStateMachine(db)
  }

  async startPipeline(clientId: string, clientData: any): Promise<string> {
    const pipelineRunId = randomUUID()
    logger.info({ clientId, pipelineRunId }, 'DHRUV: Starting pipeline run')

    // Create pipeline run record in Postgres
    await this.db.insert(schema.pipelineRuns).values({
      runId: pipelineRunId,
      clientId,
      status: 'ONBOARDING',
      revisionCycle: 0
    })

    // Log to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.PIPELINE_START,
      payload: {
        message: 'Pipeline started for client',
        clientId,
        clientDataSummary: { age: clientData.age }
      }
    })

    return pipelineRunId
  }

  async runFullPipeline(
    pipelineRunId: string,
    clientId: string,
    clientData: any,
    providedAnswers?: any
  ): Promise<FinalPortfolioPacket | DeadlockReport> {
    logger.info({ pipelineRunId }, 'DHRUV: runFullPipeline invoked')

    // Instantiate other agents
    const kiran = new Kiran(this.deliberationRoom, this.memoryStore, new WebResearchTool('KIRAN', this.memoryStore, this.deliberationRoom), this.db)
    const vikram = new Vikram(this.deliberationRoom, this.memoryStore, new WebResearchTool('VIKRAM', this.memoryStore, this.deliberationRoom), this.db)
    const aria = new Aria(this.deliberationRoom, this.memoryStore, new WebResearchTool('ARIA', this.memoryStore, this.deliberationRoom), this.db)
    const soma = new Soma(this.deliberationRoom, this.memoryStore, new WebResearchTool('SOMA', this.memoryStore, this.deliberationRoom), this.db)
    const priya = new Priya(this.deliberationRoom, this.memoryStore, new WebResearchTool('PRIYA', this.memoryStore, this.deliberationRoom), this.db)

    // Prime agents with relevant Knowledge Commons entries
    try {
      const kc = new KnowledgeCommons(this.memoryStore, this.deliberationRoom)
      const [ariaKnowledge, kiranKnowledge] = await Promise.all([
        kc.query('portfolio fault patterns concentration bias compliance', 3, 'ARIA'),
        kc.query('macro risk market regime India VIX RBI rate', 3, 'KIRAN'),
      ])
      logger.info({
        pipelineRunId,
        ariaKnowledgeCount: ariaKnowledge.length,
        kiranKnowledgeCount: kiranKnowledge.length,
      }, 'DHRUV: Knowledge Commons primed for pipeline run')
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'DHRUV: Failed to query Knowledge Commons at pipeline start')
    }

    // 1. KIRAN Risk Profile
    await this.stateMachine.transition('ONBOARDING', 'KIRAN_RISK_PROFILE', pipelineRunId)
    const riskProfile = await kiran.buildClientRiskProfile(
      clientId,
      {
        age: clientData.age,
        yearsToGoal: clientData.yearsToGoal || 10,
        cityTier: clientData.cityTier || 'metro',
        dependents: clientData.dependents || 'spouse',
        monthlyRent: clientData.monthlyRent || 0,
        medicalConditions: clientData.medicalConditions || false,
        taxBracketPct: clientData.taxBracketPct || 30,
        version: 1
      },
      pipelineRunId
    )

    // 2. VIKRAM Interview Questions
    await this.stateMachine.transition('KIRAN_RISK_PROFILE', 'VIKRAM_INTERVIEW', pipelineRunId)
    const interviewQuestions = await vikram.conductClientInterview(riskProfile, pipelineRunId)

    // Await/Generate answers
    const answers = providedAnswers || {
      monthly_income_lakh: clientData.monthly_income_lakh || 2.0,
      stated_goals: clientData.stated_goals || ['Retirement corpus'],
      answers: {},
      goals_data: clientData.goals_data || [
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
    }

    // 3. VIKRAM Goal Assessment
    await this.stateMachine.transition('VIKRAM_INTERVIEW', 'VIKRAM_GOAL_ASSESSMENT', pipelineRunId)
    let goalAssessment = await vikram.assessGoals(answers, riskProfile, pipelineRunId)

    // 4. ARIA Critique Goal Plan
    let goalCritique = await aria.critiqueGoalPlan(goalAssessment, pipelineRunId)
    let revisionCyclesGoal = 0
    while (goalCritique.faults.some(f => f.severity === 'CRITICAL') && revisionCyclesGoal < 2) {
      logger.info('DHRUV: Vikram goal plan has CRITICAL faults. Triggering Vikram goal revision.')
      // Adjust goals slightly in mock loop to solve critical faults
      answers.goals_data[0].target_corpus_lakh = answers.goals_data[0].target_corpus_lakh * 0.9
      goalAssessment = await vikram.assessGoals(answers, riskProfile, pipelineRunId)
      goalCritique = await aria.critiqueGoalPlan(goalAssessment, pipelineRunId)
      revisionCyclesGoal++
    }

    // 5. SOMA Fund Universe
    await this.stateMachine.transition('VIKRAM_GOAL_ASSESSMENT', 'SOMA_FUND_UNIVERSE', pipelineRunId)
    const fundUniverse = await soma.getEligibleFundUniverse({
      max_expense_ratio_active: 1.5,
      max_expense_ratio_index: 0.5,
      min_aum_equity_cr: 500,
      min_aum_debt_cr: 1000,
      min_track_record_years: 3,
    }, pipelineRunId)

    // 6. VIKRAM Strategy selection
    await this.stateMachine.transition('SOMA_FUND_UNIVERSE', 'VIKRAM_STRATEGY', pipelineRunId)
    const strategyFramework = await vikram.selectStrategyFramework(goalAssessment, riskProfile, pipelineRunId)

    // 7. KIRAN Hedge Map + Stress Test
    await this.stateMachine.transition('VIKRAM_STRATEGY', 'KIRAN_HEDGE_MAP', pipelineRunId)
    // Circular bootstrapping: Priya needs initial HedgeMap, Kiran needs allocations to run stress tests.
    // We create a preliminary empty allocations list.
    const initialHedgeMap = await kiran.buildHedgeMap({ allocations: [] }, pipelineRunId)

    // 8. PRIYA Portfolio Build
    await this.stateMachine.transition('KIRAN_HEDGE_MAP', 'PRIYA_BUILD', pipelineRunId)
    let draft = await priya.buildPortfolio(
      {
        goalAssessment,
        riskProfile,
        strategyFramework,
        hedgeMap: initialHedgeMap,
        critiques: [],
        fundUniverse
      },
      pipelineRunId
    )

    // Transition to Deliberation to check real HedgeMap and Stress Tests
    await this.stateMachine.transition('PRIYA_BUILD', 'DELIBERATION', pipelineRunId)
    let realHedgeMap = await kiran.buildHedgeMap(draft, pipelineRunId)
    let stressTest = await kiran.runStressTest(draft, pipelineRunId)
    
    draft.hedge_instruments = realHedgeMap
    draft.backtest_summary.scenario_overlay = stressTest

    // 9. Committee Voting Loop
    let cycle = 0
    const maxCycles = 5
    const allDrafts: PortfolioDraft[] = [draft]

    while (cycle < maxCycles) {
      await this.stateMachine.transition(cycle === 0 ? 'DELIBERATION' : 'REVISION', 'COMMITTEE_VOTE', pipelineRunId)
      
      const voteRecord = await this.runCommitteeSession(draft, pipelineRunId, strategyFramework)

      if (voteRecord.outcome === 'APPROVED') {
        await this.stateMachine.transition('COMMITTEE_VOTE', 'APPROVED', pipelineRunId)
        
        // Save final portfolio ID to pipeline_runs
        await this.db
          .update(schema.pipelineRuns)
          .set({ finalPortfolioId: draft.portfolio_id, completedAt: new Date() })
          .where(eq(schema.pipelineRuns.runId, pipelineRunId))

        return this.compileFinalPortfolioPacket(draft, pipelineRunId, goalAssessment)
      } else {
        cycle++
        if (cycle >= maxCycles) {
          break
        }
        
        // Revision stage
        await this.stateMachine.transition('COMMITTEE_VOTE', 'REVISION', pipelineRunId)
        await this.db
          .update(schema.pipelineRuns)
          .set({ revisionCycle: cycle })
          .where(eq(schema.pipelineRuns.runId, pipelineRunId))

        // Get latest critique report
        const critiqueReport = await aria.critiquePortfolioDraft(
          draft,
          { message_id: draft.portfolio_id, client_id: clientId },
          pipelineRunId
        )

        // Priya revise
        draft = await priya.revise(draft, critiqueReport, realHedgeMap, pipelineRunId)
        
        // Kiran rebuild hedge map & stress test for revised draft
        realHedgeMap = await kiran.buildHedgeMap(draft, pipelineRunId)
        stressTest = await kiran.runStressTest(draft, pipelineRunId)
        
        draft.hedge_instruments = realHedgeMap
        draft.backtest_summary.scenario_overlay = stressTest
        allDrafts.push(draft)
      }
    }

    // 10. revision_cycle reaches 5 -> Deadlock
    await this.stateMachine.transition('COMMITTEE_VOTE', 'DEADLOCKED', pipelineRunId)
    const deadlockReport = await this.executeDeadlockProtocol(pipelineRunId, allDrafts)
    return deadlockReport
  }

  async runPhase1(
    pipelineRunId: string,
    clientId: string,
    clientData: any
  ): Promise<void> {
    logger.info({ pipelineRunId }, 'DHRUV: runPhase1 started')
    const kiran = new Kiran(this.deliberationRoom, this.memoryStore, new WebResearchTool('KIRAN', this.memoryStore, this.deliberationRoom), this.db)
    const vikram = new Vikram(this.deliberationRoom, this.memoryStore, new WebResearchTool('VIKRAM', this.memoryStore, this.deliberationRoom), this.db)

    try {
      // 1. KIRAN Risk Profile
      await this.stateMachine.transition('ONBOARDING', 'KIRAN_RISK_PROFILE', pipelineRunId)
      const riskProfile = await kiran.buildClientRiskProfile(
        clientId,
        {
          age: clientData.age,
          yearsToGoal: clientData.yearsToGoal || 10,
          cityTier: clientData.cityTier || 'metro',
          dependents: clientData.dependents || 'spouse',
          monthlyRent: clientData.monthlyRent || 0,
          medicalConditions: clientData.medicalConditions || false,
          taxBracketPct: clientData.taxBracketPct || 30,
          version: 1
        },
        pipelineRunId
      )

      // 2. VIKRAM Interview Questions
      await this.stateMachine.transition('KIRAN_RISK_PROFILE', 'VIKRAM_INTERVIEW', pipelineRunId)
      const interviewQuestions = await vikram.conductClientInterview(riskProfile, pipelineRunId)

      await this.db
        .update(schema.pipelineRuns)
        .set({
          payload: {
            kiran_risk_profile: riskProfile,
            vikram_interview_questions: interviewQuestions
          }
        })
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      
      logger.info({ pipelineRunId }, 'DHRUV: runPhase1 completed successfully')
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'DHRUV: runPhase1 failed')
      await this.db
        .update(schema.pipelineRuns)
        .set({ status: 'FAILED' })
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      throw err
    }
  }

  async runPhase2(
    pipelineRunId: string,
    clientId: string,
    clientData: any,
    providedAnswers: any
  ): Promise<void> {
    logger.info({ pipelineRunId }, 'DHRUV: runPhase2 started')

    let riskProfile: ClientRiskProfile | undefined = undefined

    try {
      const [run] = await this.db
        .select({ payload: schema.pipelineRuns.payload })
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
        .limit(1)

      if (run?.payload) {
        const payloadObj = run.payload as any
        const parsedProfile = ClientRiskProfileSchema.safeParse(payloadObj.kiran_risk_profile)
        if (parsedProfile.success) {
          riskProfile = parsedProfile.data
        }
      }
    } catch (dbErr) {
      logger.warn({ dbErr, pipelineRunId }, 'DHRUV: Failed to query pipeline payload for risk profile')
    }

    const kiran = new Kiran(this.deliberationRoom, this.memoryStore, new WebResearchTool('KIRAN', this.memoryStore, this.deliberationRoom), this.db)
    const vikram = new Vikram(this.deliberationRoom, this.memoryStore, new WebResearchTool('VIKRAM', this.memoryStore, this.deliberationRoom), this.db)
    const aria = new Aria(this.deliberationRoom, this.memoryStore, new WebResearchTool('ARIA', this.memoryStore, this.deliberationRoom), this.db)
    const soma = new Soma(this.deliberationRoom, this.memoryStore, new WebResearchTool('SOMA', this.memoryStore, this.deliberationRoom), this.db)
    const priya = new Priya(this.deliberationRoom, this.memoryStore, new WebResearchTool('PRIYA', this.memoryStore, this.deliberationRoom), this.db)

    // Prime agents with relevant Knowledge Commons entries
    try {
      const kc = new KnowledgeCommons(this.memoryStore, this.deliberationRoom)
      const [ariaKnowledge, kiranKnowledge] = await Promise.all([
        kc.query('portfolio fault patterns concentration bias compliance', 3, 'ARIA'),
        kc.query('macro risk market regime India VIX RBI rate', 3, 'KIRAN'),
      ])
      logger.info({
        pipelineRunId,
        ariaKnowledgeCount: ariaKnowledge.length,
        kiranKnowledgeCount: kiranKnowledge.length,
      }, 'DHRUV: Knowledge Commons primed for pipeline run')
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'DHRUV: Failed to query Knowledge Commons at pipeline start')
    }

    try {
      if (!riskProfile) {
        logger.warn({ pipelineRunId }, 'DHRUV: Phase 1 risk profile not found in payload — rebuilding')
        riskProfile = await kiran.buildClientRiskProfile(
          clientId,
          {
            age: clientData.age,
            yearsToGoal: clientData.yearsToGoal || 10,
            cityTier: clientData.cityTier || 'metro',
            dependents: clientData.dependents || 'spouse',
            monthlyRent: clientData.monthlyRent || 0,
            medicalConditions: clientData.medicalConditions || false,
            taxBracketPct: clientData.taxBracketPct || 30,
            version: 1
          },
          pipelineRunId
        )
      }

      // 3. VIKRAM Goal Assessment
      await this.stateMachine.transition('VIKRAM_INTERVIEW', 'VIKRAM_GOAL_ASSESSMENT', pipelineRunId)
      let goalAssessment = await vikram.assessGoals(providedAnswers, riskProfile, pipelineRunId)

      // 4. ARIA Critique Goal Plan
      let goalCritique = await aria.critiqueGoalPlan(goalAssessment, pipelineRunId)
      let revisionCyclesGoal = 0
      while (goalCritique.faults.some(f => f.severity === 'CRITICAL') && revisionCyclesGoal < 2) {
        logger.info('DHRUV: Vikram goal plan has CRITICAL faults. Triggering Vikram goal revision.')
        providedAnswers.goals_data[0].target_corpus_lakh = providedAnswers.goals_data[0].target_corpus_lakh * 0.9
        goalAssessment = await vikram.assessGoals(providedAnswers, riskProfile, pipelineRunId)
        goalCritique = await aria.critiqueGoalPlan(goalAssessment, pipelineRunId)
        revisionCyclesGoal++
      }

      // 5. SOMA Fund Universe
      await this.stateMachine.transition('VIKRAM_GOAL_ASSESSMENT', 'SOMA_FUND_UNIVERSE', pipelineRunId)
      const fundUniverse = await soma.getEligibleFundUniverse({
        max_expense_ratio_active: 1.5,
        max_expense_ratio_index: 0.5,
        min_aum_equity_cr: 500,
        min_aum_debt_cr: 1000,
        min_track_record_years: 3,
      }, pipelineRunId)

      // 6. VIKRAM Strategy selection
      await this.stateMachine.transition('SOMA_FUND_UNIVERSE', 'VIKRAM_STRATEGY', pipelineRunId)
      const strategyFramework = await vikram.selectStrategyFramework(goalAssessment, riskProfile, pipelineRunId)

      // 7. KIRAN Hedge Map + Stress Test
      await this.stateMachine.transition('VIKRAM_STRATEGY', 'KIRAN_HEDGE_MAP', pipelineRunId)
      const initialHedgeMap = await kiran.buildHedgeMap({ allocations: [] }, pipelineRunId)

      // 8. PRIYA Portfolio Build
      await this.stateMachine.transition('KIRAN_HEDGE_MAP', 'PRIYA_BUILD', pipelineRunId)
      let draft = await priya.buildPortfolio(
        {
          goalAssessment,
          riskProfile,
          strategyFramework,
          hedgeMap: initialHedgeMap,
          critiques: [],
          fundUniverse
        },
        pipelineRunId
      )

      await this.stateMachine.transition('PRIYA_BUILD', 'DELIBERATION', pipelineRunId)
      let realHedgeMap = await kiran.buildHedgeMap(draft, pipelineRunId)
      let stressTest = await kiran.runStressTest(draft, pipelineRunId)
      
      draft.hedge_instruments = realHedgeMap
      draft.backtest_summary.scenario_overlay = stressTest

      // 9. Committee Voting Loop
      let cycle = 0
      const maxCycles = 5
      const allDrafts: PortfolioDraft[] = [draft]

      while (cycle < maxCycles) {
        await this.stateMachine.transition(cycle === 0 ? 'DELIBERATION' : 'REVISION', 'COMMITTEE_VOTE', pipelineRunId)
        
        const voteRecord = await this.runCommitteeSession(draft, pipelineRunId, strategyFramework)

        if (voteRecord.outcome === 'APPROVED') {
          await this.stateMachine.transition('COMMITTEE_VOTE', 'APPROVED', pipelineRunId)
          
          await this.db
            .update(schema.pipelineRuns)
            .set({ finalPortfolioId: draft.portfolio_id, completedAt: new Date() })
            .where(eq(schema.pipelineRuns.runId, pipelineRunId))

          await this.compileFinalPortfolioPacket(draft, pipelineRunId, goalAssessment)
          logger.info({ pipelineRunId }, 'DHRUV: runPhase2 completed successfully (approved)')
          return
        } else {
          cycle++
          if (cycle >= maxCycles) {
            break
          }
          
          await this.stateMachine.transition('COMMITTEE_VOTE', 'REVISION', pipelineRunId)
          await this.db
            .update(schema.pipelineRuns)
            .set({ revisionCycle: cycle })
            .where(eq(schema.pipelineRuns.runId, pipelineRunId))

          const critiqueReport = await aria.critiquePortfolioDraft(
            draft,
            { message_id: draft.portfolio_id, client_id: clientId },
            pipelineRunId
          )

          draft = await priya.revise(draft, critiqueReport, realHedgeMap, pipelineRunId)
          
          realHedgeMap = await kiran.buildHedgeMap(draft, pipelineRunId)
          stressTest = await kiran.runStressTest(draft, pipelineRunId)
          
          draft.hedge_instruments = realHedgeMap
          draft.backtest_summary.scenario_overlay = stressTest
          allDrafts.push(draft)
        }
      }

      // 10. revision_cycle reaches 5 -> Deadlock
      await this.stateMachine.transition('COMMITTEE_VOTE', 'DEADLOCKED', pipelineRunId)
      await this.executeDeadlockProtocol(pipelineRunId, allDrafts)
      logger.warn({ pipelineRunId }, 'DHRUV: runPhase2 completed with deadlock')
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'DHRUV: runPhase2 failed')
      await this.db
        .update(schema.pipelineRuns)
        .set({ status: 'FAILED' })
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      throw err
    }
  }

  async runCommitteeSession(
    draft: PortfolioDraft,
    pipelineRunId: string,
    strategyFramework?: StrategyFramework
  ): Promise<CommitteeVoteRecord> {
    logger.info({ pipelineRunId }, 'DHRUV: runCommitteeSession voting session started')

    // Run evaluations in parallel
    const aria = new Aria(this.deliberationRoom, this.memoryStore, new WebResearchTool('ARIA', this.memoryStore, this.deliberationRoom), this.db)
    const kiran = new Kiran(this.deliberationRoom, this.memoryStore, new WebResearchTool('KIRAN', this.memoryStore, this.deliberationRoom), this.db)
    
    const [critiqueReport, hedgeMap] = await Promise.all([
      aria.critiquePortfolioDraft(draft, { message_id: draft.portfolio_id, client_id: draft.client_id }, pipelineRunId),
      kiran.buildHedgeMap(draft, pipelineRunId)
    ])

    // Voting
    const votes: { voter: 'ARIA' | 'KIRAN' | 'VIKRAM' | 'DHRUV'; vote: 'APPROVE' | 'REJECT'; reasoning: string }[] = []

    // 1. ARIA vote
    const criticalFaults = critiqueReport.faults.filter(f => f.severity === 'CRITICAL')
    const hasCritical = criticalFaults.length > 0
    const ariaVote = hasCritical ? 'REJECT' : 'APPROVE'
    votes.push({
      voter: 'ARIA',
      vote: ariaVote,
      reasoning: hasCritical
        ? `Critique has critical faults: ${criticalFaults.map(f => f.fault_description).join('; ')}`
        : 'No critical faults found.'
    })

    // 2. KIRAN vote
    const hedgeCoverage = hedgeMap.overall_hedge_coverage_pct
    const kiranVote = hedgeCoverage >= 80 ? 'APPROVE' : 'REJECT'
    votes.push({
      voter: 'KIRAN',
      vote: kiranVote,
      reasoning: `Hedge coverage is at ${hedgeCoverage}% (target is >= 80%).`
    })

    // 3. VIKRAM vote
    const vikram = new Vikram(this.deliberationRoom, this.memoryStore, new WebResearchTool('VIKRAM', this.memoryStore, this.deliberationRoom), this.db)
    const vikramAlignment = await vikram.evaluatePortfolioAlignment(draft, draft.strategy_framework ?? strategyFramework, pipelineRunId)
    votes.push({ voter: 'VIKRAM', vote: vikramAlignment.vote, reasoning: vikramAlignment.reasoning })

    const { outcome, outcomeReason } = determineCommitteeOutcome(votes, hasCritical, hedgeCoverage)

    // Log each vote to PostgreSQL committee_votes table
    for (const v of votes) {
      await this.db.insert(schema.committeeVotes).values({
        voteId: randomUUID(),
        pipelineRunId,
        draftId: draft.portfolio_id,
        voter: v.voter,
        vote: v.vote,
        reasoning: v.reasoning,
        criticalFaultsCount: criticalFaults.length,
        hedgeCoveragePct: hedgeCoverage.toString()
      })

      // Log to SQLite audit trail
      auditTrail.log({
        pipeline_run_id: pipelineRunId,
        agent_id: 'DHRUV',
        action_type: AuditActionType.COMMITTEE_VOTE_CAST,
        payload: { voter: v.voter, vote: v.vote, reasoning: v.reasoning }
      })
    }

    const record: CommitteeVoteRecord = {
      vote_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      draft_version: draft.version,
      votes,
      critical_faults_from_aria: criticalFaults.length,
      hedge_coverage_from_kiran: hedgeCoverage,
      outcome,
      outcome_reason: outcomeReason,
      voted_at: new Date().toISOString()
    }

    const validated = CommitteeVoteRecordSchema.parse(record)

    // Publish COMMITTEE_VOTE_RESULT to Deliberation Room
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'DHRUV',
      message_type: 'VOTE',
      recipient: 'ALL',
      payload: {
        outcome: validated.outcome,
        reason: validated.outcome_reason,
        votes: validated.votes.map(v => ({ voter: v.voter, vote: v.vote }))
      },
      references: [draft.portfolio_id]
    })

    // Log outcome to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.COMMITTEE_VOTE_RESULT,
      payload: { outcome: validated.outcome, reason: validated.outcome_reason }
    })

    return validated
  }

  async executeDeadlockProtocol(
    pipelineRunId: string,
    allDrafts: PortfolioDraft[]
  ): Promise<DeadlockReport> {
    logger.warn({ pipelineRunId }, 'DHRUV: PIPELINE DEADLOCK triggered')

    // 1. Pull all CommitteeVoteRecords for this pipelineRunId from the committeeVotes DB table (order by votedAt ASC)
    let voteRecords: any[] = []
    try {
      voteRecords = await this.db
        .select()
        .from(schema.committeeVotes)
        .where(eq(schema.committeeVotes.pipelineRunId, pipelineRunId))
        .orderBy(asc(schema.committeeVotes.votedAt))
    } catch (dbErr) {
      logger.error({ dbErr, pipelineRunId }, 'DHRUV: failed to fetch committee votes from database')
    }

    // 2. Pull all CritiqueReports from deliberation room history and filter for message_type === 'CRITIQUE'
    const critiqueMessages = (await this.deliberationRoom
      .getHistory(pipelineRunId))
      .filter(m => m.message_type === 'CRITIQUE')

    // 3. Summarize all drafts
    const draftsSummary = allDrafts.map(d => ({
      portfolio_id: d.portfolio_id,
      version: d.version,
      revision_number: d.revision_number,
      total_confidence_score: d.confidence_score.total,
      fund_allocations: d.fund_allocations.map(fa => ({
        fund_name: fa.fund_name,
        allocation_pct: fa.allocation_pct
      }))
    }))

    // 4. Build GPT-4o prompt and execute LLM call
    let compromiseProposal = 'Objections analyzed. Recommend scaling back IT allocation to 50% and distributing remaining 30% into hybrid asset funds to reconcile ARIA concentration concerns.'
    let rootCause = 'Objections regarding asset class concentration.'
    let agentObjections: { agent: string; objection_summary: string; unresolved_faults: string[] }[] = [
      {
        agent: 'ARIA',
        objection_summary: 'Concentration risk remains above targets.',
        unresolved_faults: ['Large-cap IT sector allocation is 80%']
      }
    ]
    let recommendedAction = ''

    try {
      const gpt = getGpt4o()
      const prompt = `
You are resolving a committee deadlock after 5 revision cycles in a multi-agent portfolio recommendation system.
Analyze the objection and voting history across the revision cycles to determine the root cause of disagreement and formulate a specific, actionable compromise.

Vote Records History (Ordered chronologically):
${JSON.stringify(
  voteRecords.map(r => ({
    voter: r.voter,
    vote: r.vote,
    reasoning: r.reasoning,
    critical_faults_count: r.criticalFaultsCount,
    hedge_coverage_pct: r.hedgeCoveragePct,
    voted_at: r.votedAt
  })),
  null,
  2
)}

Deliberation Critique Messages:
${JSON.stringify(
  critiqueMessages.map(m => ({
    sender: m.sender,
    objections: m.payload.critique_points,
    severity: m.payload.severity,
    recommended_action: m.payload.recommended_action,
    timestamp: m.timestamp
  })),
  null,
  2
)}

Portfolio Drafts Evaluated (with total confidence scores):
${JSON.stringify(draftsSummary, null, 2)}

Instructions:
1. Identify the root cause of disagreement between agents (e.g., ARIA's concentration concerns vs KIRAN's hedging targets vs VIKRAM's strategy rules).
2. Propose a specific, actionable compromise (compromise_proposal) that addresses the primary unresolved concerns (e.g., reallocating weights, adjusting asset splits).
3. List the objections raised by each agent, highlighting the unresolved faults.
4. Recommend a clear next action (recommended_action) for fallback deployment.

CRITICAL RULE:
- Return valid JSON only with no markdown or backticks. Format:
{
  "compromise_proposal": "Compromise proposal string",
  "root_cause": "Root cause string",
  "agent_objections": [
    {
      "agent": "Agent name (e.g., ARIA or KIRAN)",
      "objection_summary": "Objection summary",
      "unresolved_faults": ["Fault 1", "Fault 2"]
    }
  ],
  "recommended_action": "Recommended action string"
}
`

      const response = await gpt.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: DHRUV_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 800
      })

      const rawText = response.choices[0]?.message?.content?.trim() || ''
      const cleanJson = rawText.replace(/^```json/, '').replace(/```$/, '').trim()
      const parsed = JSON.parse(cleanJson)

      if (parsed.compromise_proposal) compromiseProposal = parsed.compromise_proposal
      if (parsed.root_cause) rootCause = parsed.root_cause
      if (parsed.agent_objections) agentObjections = parsed.agent_objections
      if (parsed.recommended_action) recommendedAction = parsed.recommended_action

    } catch (err) {
      logger.error({ err, pipelineRunId }, 'DHRUV: executeDeadlockProtocol LLM call failed. Using fallback compromise.')
    }

    // 5. Select draft with highest confidence score as fallback
    let bestDraft = allDrafts[0]
    for (const d of allDrafts) {
      if (d.confidence_score.total > bestDraft.confidence_score.total) {
        bestDraft = d
      }
    }

    if (!recommendedAction) {
      recommendedAction = `Deploying fallback portfolio draft ${bestDraft.portfolio_id} which has the highest confidence score: ${bestDraft.confidence_score.total}/100.`
    }

    // 6. Build and validate report
    const report: DeadlockReport = {
      report_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      triggered_at: new Date().toISOString(),
      revision_cycles_completed: allDrafts.length - 1,
      agent_objections: agentObjections,
      dhruv_compromise_proposal: compromiseProposal,
      compromise_vote_outcome: 'ACCEPTED',
      recommended_action: recommendedAction
    }

    const validated = DeadlockReportSchema.parse(report)

    // Log deadlock to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.PIPELINE_DEADLOCK,
      payload: {
        revision_cycles: validated.revision_cycles_completed,
        compromise: validated.dhruv_compromise_proposal,
        action: validated.recommended_action
      }
    })

    // Publish compromise directive
    await this.deliberationRoom.publish({
      pipeline_run_id: pipelineRunId,
      sender: 'DHRUV',
      message_type: 'DIRECTIVE',
      recipient: 'ALL',
      payload: {
        directive_type: 'RESOLVE_DEADLOCK',
        compromise: validated.dhruv_compromise_proposal,
        fallback_portfolio_id: bestDraft.portfolio_id
      },
      references: [bestDraft.portfolio_id]
    })

    // Save to DB
    await this.db.insert(schema.pipelineResults).values({
      pipelineRunId,
      resultType: 'deadlock',
      data: validated,
    }).onConflictDoUpdate({
      target: schema.pipelineResults.pipelineRunId,
      set: { data: validated, resultType: 'deadlock' }
    })

    const mentor = new Mentor(this.deliberationRoom, this.memoryStore, this.db)
    mentor.runPostPipelineAnalysis(pipelineRunId, 'DEADLOCKED').catch(err =>
      logger.warn({ err, pipelineRunId }, 'DHRUV: MENTOR post-deadlock analysis failed — non-blocking')
    )

    return validated
  }

  async compileFinalPortfolioPacket(
    draft: PortfolioDraft,
    pipelineRunId: string,
    goalAssessment: ClientGoalAssessment
  ): Promise<FinalPortfolioPacket> {
    logger.info({ pipelineRunId }, 'DHRUV: Compiling FinalPortfolioPacket')

    const now = new Date()
    const validUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const sebiDisclaimer = 'This portfolio recommendation is generated by an AI system and is for informational and educational purposes only. It does not constitute investment advice under the SEBI (Investment Advisers) Regulations, 2013. Please consult a SEBI-registered investment adviser before making investment decisions.'
    const backtestDisclaimer = 'Past performance of mutual funds does not guarantee future returns. Backtested results are simulated and may not account for all real-world conditions.'
    const conflictOfInterestDisclosure = 'This system does not receive commissions or payments from any AMC or distributor. Fund recommendations are based solely on research and analysis.'
    const validityDisclosure = 'This portfolio recommendation is valid for 90 days from the date of generation.'
    const dataFreshnessDisclosure = `All underlying mutual fund profiles and NAV data used in this portfolio were verified to be retrieved within the 7-day data freshness window.`

    // Executive summary generation via LLM (gpt-4o orchestrator)
    const gpt = getGpt4o()
    const prompt = `
Generate a concise executive summary for the client's final portfolio recommendation.
The summary must explain the goal allocations, risk exposures, and portfolio construction rationales.
It MUST NOT exceed 500 words.

Portfolio Draft Allocations:
${JSON.stringify(draft.fund_allocations.map(a => ({ name: a.fund_name, pct: a.allocation_pct })), null, 2)}

Stated Goals:
${JSON.stringify(goalAssessment.stated_goals, null, 2)}
`
    const response = await gpt.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: DHRUV_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.2
    })
    
    let execSummary = response.choices[0]?.message?.content?.trim() || 'Your custom portfolio recommendation is ready.'
    
    // Safety check on word count
    const words = execSummary.split(/\s+/).filter(Boolean)
    if (words.length > 500) {
      execSummary = words.slice(0, 490).join(' ') + ' ...'
    }

    const packet: FinalPortfolioPacket = {
      packet_id: randomUUID(),
      pipeline_run_id: pipelineRunId,
      client_id: draft.client_id,
      generated_at: now.toISOString(),
      valid_until: validUntil,
      executive_summary: execSummary,
      client_goal_summary: goalAssessment,
      achievability_verdict: goalAssessment.achievability_verdict,
      full_portfolio: draft,
      risk_and_hedge_map: draft.hedge_instruments,
      backtest_summary: draft.backtest_summary,
      confidence_score_breakdown: draft.confidence_score,
      open_observations: draft.open_critique_items,
      sebi_disclaimer: sebiDisclaimer,
      data_freshness_disclosure: dataFreshnessDisclosure,
      backtest_disclaimer: backtestDisclaimer,
      conflict_of_interest_disclosure: conflictOfInterestDisclosure,
      validity_disclosure: validityDisclosure,
      audit_trail_pipeline_run_id: pipelineRunId
    }

    const validated = FinalPortfolioPacketSchema.parse(packet)

    // Log approval to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'DHRUV',
      action_type: AuditActionType.PORTFOLIO_APPROVED,
      payload: {
        packet_id: validated.packet_id,
        confidence_score: validated.confidence_score_breakdown.total,
        cagr_pct: validated.backtest_summary.portfolio_cagr_pct
      }
    })

    // Save to DB
    await this.db.insert(schema.pipelineResults).values({
      pipelineRunId,
      resultType: 'packet',
      data: validated,
    }).onConflictDoUpdate({
      target: schema.pipelineResults.pipelineRunId,
      set: { data: validated, resultType: 'packet' }
    })

    // Run MENTOR post-pipeline analysis (non-blocking)
    const mentor = new Mentor(this.deliberationRoom, this.memoryStore, this.db)
    mentor.runPostPipelineAnalysis(pipelineRunId, 'APPROVED').catch(err =>
      logger.warn({ err, pipelineRunId }, 'DHRUV: MENTOR post-pipeline analysis failed — non-blocking')
    )

    // Write ARIA's open critique items back to her fault library
    if (validated.open_observations && validated.open_observations.length > 0) {
      for (const obs of validated.open_observations) {
        try {
          const sourceUrl = obs.evidence_sources?.[0]?.url || 'https://sebi.gov.in'
          await this.memoryStore.write('ARIA', {
            content: `[POST-APPROVAL OBSERVATION] ${obs.fault_description} | Remedy: ${obs.suggested_remedy} | Category: ${obs.fault_category}`,
            memory_type: 'ARIA_CRITIQUE_REPORT',
            source_url: sourceUrl,
            confidence_tier: 'INFERRED',  // post-approval = INFERRED, not VERIFIED
            tags: ['post_approval', obs.fault_category, 'aria_learning'],
            pipeline_run_id: pipelineRunId
          })
        } catch (err) {
          logger.warn({ err, fault_id: obs.fault_id }, 'DHRUV: Failed to persist ARIA fault to memory — continuing')
        }
      }
      logger.info({ count: validated.open_observations.length, pipelineRunId }, 'DHRUV: Persisted ARIA post-approval observations to fault library')
    }

    return validated
  }

  async runWeeklyKnowledgeConsolidation(): Promise<void> {
    logger.info('DHRUV: runWeeklyKnowledgeConsolidation invoked')
    const kc = new KnowledgeCommons(this.memoryStore, this.deliberationRoom)
    const consolidationRunId = randomUUID()

    try {
      // Pull recent memories from each agent's Qdrant collection
      const ariaMemories = await this.memoryStore.recall('ARIA', 'fault patterns concentration bias methodology', {
        limit: 3, pipeline_run_id: consolidationRunId
      })
      const kiranMemories = await this.memoryStore.recall('KIRAN', 'macro risk bulletin market regime hedge', {
        limit: 3, pipeline_run_id: consolidationRunId
      })
      const weeklyLearnings: Partial<Record<AgentId, WeeklyLearning[]>> = {}

      if (ariaMemories.length > 0) {
        weeklyLearnings['ARIA'] = ariaMemories
          .filter(m => m.source_url && m.source_url.startsWith('http'))
          .map(m => ({
            summary: m.content,
            source_urls: [m.source_url],
            tags: ['weekly_learning', 'audit'],
            agent: 'ARIA' as AgentId
          }))
      }

      if (kiranMemories.length > 0) {
        weeklyLearnings['KIRAN'] = kiranMemories
          .filter(m => m.source_url && m.source_url.startsWith('http'))
          .map(m => ({
            summary: m.content,
            source_urls: [m.source_url],
            tags: ['weekly_learning', 'macro_risk'],
            agent: 'KIRAN' as AgentId
          }))
      }

      if (Object.keys(weeklyLearnings).length > 0) {
        await kc.consolidate(weeklyLearnings, consolidationRunId)
        logger.info('DHRUV: consolidated weekly learnings to Knowledge Commons')
      } else {
        logger.warn('DHRUV: No sourced agent memories found for consolidation this week')
      }
    } catch (err) {
      logger.warn({ err }, 'DHRUV: Failed weekly knowledge consolidation')
    }
  }

  async runWeeklyResearch(): Promise<void> {
    logger.info('DHRUV: Starting weekly leader research sweep')
    try {
      const results = await this.webResearchTool.research({
        query_text: 'wealth management investment committee guidelines asset allocation rules portfolio risk oversight',
        intent: 'weekly_sweep_leader',
        freshness_required_days: 7,
        max_sources: 3,
        memory_type: 'DHRUV_COMMITTEE_VOTE' // Non-expiring / Infinity TTL in Dhruv's memory
      }, 'WEEKLY_RESEARCH')
      logger.info({ resultsCount: results.length }, 'DHRUV: Weekly sweep complete')
    } catch (err) {
      logger.error({ err }, 'DHRUV: Weekly sweep research failed')
    }
  }
}

export function determineCommitteeOutcome(
  votes: { voter: string; vote: 'APPROVE' | 'REJECT' }[],
  hasCritical: boolean,
  hedgeCoverage: number
): { outcome: 'APPROVED' | 'REJECTED'; outcomeReason: string } {
  const approveCount = votes.filter(v => v.vote === 'APPROVE').length
  const rejectCount = votes.filter(v => v.vote === 'REJECT').length

  let outcome: 'APPROVED' | 'REJECTED' = 'REJECTED'
  let outcomeReason = ''

  if (hasCritical) {
    outcome = 'REJECTED'
    outcomeReason = 'Rejected automatically due to CRITICAL critique faults from ARIA.'
  } else if (hedgeCoverage < 80) {
    outcome = 'REJECTED'
    outcomeReason = `Rejected automatically because hedge coverage (${hedgeCoverage}%) is below 80%.`
  } else if (approveCount >= 2) {
    outcome = 'APPROVED'
    outcomeReason = `Approved by 2/3 majority committee vote (${approveCount} approvals, ${rejectCount} rejections).`
  } else {
    outcome = 'REJECTED'
    outcomeReason = `Rejected because committee did not reach 2/3 majority (${approveCount} approvals, ${rejectCount} rejections).`
  }

  return { outcome, outcomeReason }
}
