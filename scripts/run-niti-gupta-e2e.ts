import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { randomUUID } from 'crypto'
import { Dhruv } from '../lib/agents/dhruv'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { agentMemoryStore } from '../lib/memory/memory-store'
import { WebResearchTool } from '../lib/research/web-research-tool'

async function main() {
  console.log('--- Checking Server Health ---')
  const healthUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/health'
  const healthRes = await fetch(healthUrl)
  const healthData = await healthRes.json()
  const checks = healthData.data || healthData.error?.details?.checks || {}
  
  if (!checks.qdrant || checks.qdrant.status !== 'ok') throw new Error('Qdrant not ready — run the server first')
  if (!checks.db || checks.db.status !== 'ok') throw new Error('DB not ready')

  console.log('--- Initializing Database for Niti Gupta (E2E) ---')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const dbInstance = drizzle(pool, { schema })

async function runScenario(
  dbInstance: any,
  pool: Pool,
  scenarioName: string,
  monthlyIncomeLakh: number,
  expectDeadlock: boolean
) {
  console.log(`\n\n=== SCENARIO: ${scenarioName} ===\n`)
  const mockUserId = randomUUID()

  // 1. Seed user profile
  await dbInstance.insert(schema.users).values({ id: mockUserId }).onConflictDoNothing()
  await dbInstance.insert(schema.userProfile).values({
    userId: mockUserId,
    age: 34,
    cityTier: 'metro', 
    monthlyRent: '35000', 
    ownsHome: false,
    dependents: 'kids',
    medicalConditions: false,
    inflationRate: '7.0',
    computedAt: new Date()
  }).onConflictDoNothing()

  // 1b. Seed CAS Holdings via Pipeline
  const isDriftTest = process.env.DRIFT_TEST === 'true'
  const isForceVision = process.env.FORCE_VISION === 'true'
  
  const { nitiGuptaHoldings } = await import('./fixtures/niti-gupta-holdings')
  const { nitiGuptaHoldingsV2 } = await import('./fixtures/niti-gupta-holdings-v2')
  const { injectCASForUser } = await import('./utils/inject-cas')

  const holdings = isDriftTest ? nitiGuptaHoldingsV2 : nitiGuptaHoldings
  const expectedCount = isDriftTest ? 8 : 7

  const casResult = await injectCASForUser(mockUserId, holdings, { forceVisionFallback: isForceVision })
  console.log(`CAS injected: ${casResult.holdingsCount} holdings, confidence ${casResult.parseConfidence}, mode: ${casResult.parseMode}`)

  if (casResult.holdingsCount !== expectedCount) {
    throw new Error(`Expected ${expectedCount} holdings, got ${casResult.holdingsCount}`)
  }

  const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
  const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, dbInstance as any)

  const clientData = {
    age: 34,
    cityTier: 'metro' as const,
    monthlyRent: 35000,
    ownsHome: false,
    dependents: 'kids' as const,
    medicalConditions: false,
    yearsToGoal: 26, // Retirement is longest
    taxBracketPct: 30,
    version: 1
  }

  const runId = await dhruv.startPipeline(mockUserId, clientData)
  console.log(`Pipeline Started: ${runId}`)

  console.log('--- Running Phase 1 (Onboarding -> Kiran Risk Profile -> Vikram Interview) ---')
  await dhruv.runPhase1(runId, mockUserId, clientData)

  const { GOAL_TYPE } = await import('../lib/types/goal-types')
  const providedAnswers = {
    monthly_income_lakh: monthlyIncomeLakh,
    monthly_expenses_lakh: 0.8, // Approximation based on rent and other expenses
    stated_goals: [
      "Child's higher education — ₹50L corpus in 14 years",
      "Own apartment down payment — ₹30L in 6 years",
      "Retirement — ₹3Cr corpus in 26 years"
    ],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.CHILD_EDUCATION,
        description: "Child's higher education — ₹50L corpus in 14 years",
        target_corpus_lakh: 50.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 14, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.HOME_PURCHASE,
        description: "Own apartment down payment — ₹30L in 6 years",
        target_corpus_lakh: 30.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 6, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.RETIREMENT,
        description: "Retirement — ₹3Cr corpus in 26 years",
        target_corpus_lakh: 300.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 26, 0, 1).toISOString()
      }
    ]
  }

  console.log('--- Running Phase 2 (Goal Assessment -> Portfolio Build -> Voting) ---')
  await dhruv.runPhase2(runId, mockUserId, clientData, providedAnswers as any)

  console.log('--- Pipeline Completed ---')

  const [run] = await dbInstance.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId)).limit(1)
  console.log('Final Status:', run?.status)

  if (expectDeadlock) {
    if (run?.status !== 'DEADLOCKED') throw new Error(`Expected DEADLOCKED status, got ${run?.status}`);
    const [result] = await dbInstance.select().from(schema.pipelineResults).where(eq(schema.pipelineResults.pipelineRunId, runId)).limit(1)
    if (!result || result.resultType !== 'deadlock') throw new Error(`Expected pipeline_results to have result_type='deadlock'`);
    console.log('Successfully confirmed DEADLOCKED status and deadlock payload.');
    console.log('Deadlock Directive:', (result.data as any).directive);
  } else {
    if (run?.status !== 'COMPLETED' && run?.status !== 'APPROVED') {
      console.warn(`Expected successful completion, got ${run?.status}. (Check if it deadlocked unexpectedly)`);
    } else {
      const [result] = await dbInstance.select().from(schema.pipelineResults).where(eq(schema.pipelineResults.pipelineRunId, runId)).limit(1)
      console.log('\n===== FINAL PORTFOLIO =====\n')
      console.log(JSON.stringify((result?.data as any)?.fullPortfolio || result?.data, null, 2))
      console.log('\n===========================\n')
    }
  }

  // Also check if subsequent API calls would succeed
  const postPipelineUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/health' // Using health just to check server alive
  const healthRes = await fetch(postPipelineUrl)
  if (!healthRes.ok) throw new Error('Server dead after pipeline run.')
}

async function main() {
  console.log('--- Checking Server Health ---')
  const healthUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/health'
  const healthRes = await fetch(healthUrl)
  const healthData = await healthRes.json()
  const checks = healthData.data || healthData.error?.details?.checks || {}
  
  if (!checks.qdrant || checks.qdrant.status !== 'ok') throw new Error('Qdrant not ready — run the server first')
  if (!checks.db || checks.db.status !== 'ok') throw new Error('DB not ready')

  console.log('--- Initializing Database for Niti Gupta (E2E) ---')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const dbInstance = drizzle(pool, { schema })

  await runScenario(dbInstance, pool, 'Success Path - Normal Cash Flow', 1.2, false)
  await runScenario(dbInstance, pool, 'Mathematical Impossibility - Insufficient Cash Flow', 0.6, true)

  await pool.end()
}

main().catch(console.error)
