import { db } from '../lib/db'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { Dhruv } from '../lib/agents/dhruv'
import { agentMemoryStore, initQdrant } from '../lib/memory/memory-store'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { WebResearchTool } from '../lib/research/web-research-tool'
import logger from '../lib/logger'

async function main() {
  const clientId = '00000000-0000-0000-0000-000000000000'
  console.log('🚀 Starting Real-World Multi-Agent Pipeline Sweep...')

  console.log('Initializing Qdrant collections...')
  await initQdrant()

  // Setup user and profile
  console.log('Seeding user and user profile...')
  await db.insert(schema.users).values({ id: clientId }).onConflictDoNothing()
  await db.insert(schema.userProfile).values({
    userId: clientId,
    age: 35,
    cityTier: 'metro',
    monthlyRent: '25000',
    ownsHome: false,
    dependents: 'spouse',
    medicalConditions: true,
    inflationRate: '6.0',
    computedAt: new Date()
  }).onConflictDoNothing()

  // Instantiate Dhruv agent
  console.log('Initializing Dhruv Orchestrator agent...')
  const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
  const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, db)

  const clientData = {
    age: 35,
    cityTier: 'metro' as const,
    monthlyRent: 25000,
    ownsHome: false,
    dependents: 'spouse' as const,
    medicalConditions: true,
    yearsToGoal: 10,
    taxBracketPct: 30,
    version: 1
  }

  // Start the pipeline
  console.log('Starting pipeline run...')
  const runId = await dhruv.startPipeline(clientId, clientData)
  console.log(`Pipeline started. Run ID: ${runId}`)

  // Run Phase 1
  console.log('Executing Phase 1 (Risk Profiling & Interview Generation)...')
  await dhruv.runPhase1(runId, clientId, clientData)
  console.log('Phase 1 Completed.')

  // Check stage
  const [run1] = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId)).limit(1)
  console.log(`Current Pipeline Stage: ${run1.status}`)

  // Prepare Vikram interview answers
  const providedAnswers = {
    monthly_income_lakh: 3.5,
    stated_goals: ['Retirement corpus'],
    answers: {
      "What is your target investment horizon?": "10 years",
      "What is your target retirement corpus?": "100 Lakhs"
    },
    goals_data: [
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

  // Run Phase 2
  console.log('Executing Phase 2 (Goal Assessment, Strategy selection, Hedging, Portfolio Build, Deliberation, Voting)...')
  await dhruv.runPhase2(runId, clientId, clientData, providedAnswers)
  console.log('Phase 2 Completed.')

  // Check status & results
  const [run2] = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId)).limit(1)
  console.log(`Pipeline Status: ${run2.status}`)

  const [result] = await db
    .select()
    .from(schema.pipelineResults)
    .where(eq(schema.pipelineResults.pipelineRunId, runId))
    .limit(1)

  if (result) {
    console.log('\n==================================================')
    console.log(`Pipeline Result (Type: ${result.resultType})`)
    console.log('==================================================')
    console.log(JSON.stringify(result.data, null, 2))
    console.log('==================================================')
  } else {
    console.log('⚠️ No result found in pipeline_results table.')
  }

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Pipeline execution failed:', err)
  process.exit(1)
})
