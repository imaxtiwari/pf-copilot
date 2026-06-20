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
    age: 52,
    cityTier: 'metro', 
    monthlyRent: '0', 
    ownsHome: true,
    dependents: 'kids',
    medicalConditions: false,
    inflationRate: '7.0',
    computedAt: new Date()
  }).onConflictDoNothing()

  // 1b. Seed CAS Holdings via Pipeline
  const isForceVision = process.env.FORCE_VISION === 'true'
  
  const { rohanMehtaHoldings } = await import('./fixtures/rohan-mehta-holdings')
  const { injectCASForUser } = await import('./utils/inject-cas')

  const expectedCount = 8

  const casResult = await injectCASForUser(mockUserId, rohanMehtaHoldings, { forceVisionFallback: isForceVision })
  console.log(`CAS injected: ${casResult.holdingsCount} holdings, confidence ${casResult.parseConfidence}, mode: ${casResult.parseMode}`)

  const casResultDup = await injectCASForUser(mockUserId, rohanMehtaHoldings, { forceVisionFallback: isForceVision })
  console.log(`CAS DUPLICATE TEST: ${casResultDup.casUploadId === casResult.casUploadId ? 'PASS' : 'FAIL'} (IDs match)`)

  if (casResult.holdingsCount !== expectedCount) {
    throw new Error(`Expected ${expectedCount} holdings, got ${casResult.holdingsCount}`)
  }

  const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
  const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, dbInstance as any)

  const clientData = {
    age: 52,
    cityTier: 'metro' as const,
    monthlyRent: 0,
    ownsHome: true,
    dependents: 'kids' as const,
    medicalConditions: false,
    yearsToGoal: 8, // Retirement is longest
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
    monthly_expenses_lakh: 1.0, // Approximation
    stated_goals: [
      "Retirement — ₹5Cr corpus in 8 years",
      "Younger child's MBA abroad — ₹40L in 3 years",
      "Medical emergency corpus — ₹15L immediately"
    ],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.RETIREMENT,
        description: "Retirement — ₹5Cr corpus in 8 years",
        target_corpus_lakh: 500.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 8, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.CHILD_EDUCATION,
        description: "Younger child's MBA abroad — ₹40L in 3 years",
        target_corpus_lakh: 40.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 3, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: GOAL_TYPE.EMERGENCY_CORPUS,
        description: "Medical emergency corpus — ₹15L immediately (within 1 year)",
        target_corpus_lakh: 15.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 1, 0, 1).toISOString()
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

  console.log('--- Initializing Database for Rohan Mehta (E2E) ---')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const dbInstance = drizzle(pool, { schema })

  // Rohan takes home 2.2L/mo.
  await runScenario(dbInstance, pool, 'Success Path - Aggressive Cash Flow', 2.2, false)
  // Force a deadlock scenario by giving him only 0.8L/mo income
  await runScenario(dbInstance, pool, 'Mathematical Impossibility - Insufficient Cash Flow', 0.8, true)

  await pool.end()
}

main().catch(console.error)
