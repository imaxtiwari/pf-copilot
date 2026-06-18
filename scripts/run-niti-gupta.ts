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
  console.log('--- Initializing Database for Niti Gupta ---')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const dbInstance = drizzle(pool, { schema })

  const mockUserId = randomUUID()

  // 1. Seed user profile
  await dbInstance.insert(schema.users).values({ id: mockUserId }).onConflictDoNothing()
  await dbInstance.insert(schema.userProfile).values({
    userId: mockUserId,
    age: 59,
    cityTier: 'metro', 
    monthlyRent: '0', 
    ownsHome: true,
    dependents: 'parents',
    medicalConditions: true,
    inflationRate: '7.0',
    computedAt: new Date()
  }).onConflictDoNothing()

  const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
  const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, dbInstance as any)

  const clientData = {
    age: 59,
    cityTier: 'metro' as const,
    monthlyRent: 0,
    ownsHome: true,
    dependents: 'parents' as const,
    medicalConditions: true,
    yearsToGoal: 10,
    taxBracketPct: 30,
    version: 1
  }

  const runId = await dhruv.startPipeline(mockUserId, clientData)
  console.log(`Pipeline Started: ${runId}`)

  console.log('--- Running Phase 1 (Onboarding -> Kiran Risk Profile -> Vikram Interview) ---')
  await dhruv.runPhase1(runId, mockUserId, clientData)

  const providedAnswers = {
    monthly_income_lakh: 0.5,
    monthly_expenses_lakh: 0.45,
    stated_goals: ["Mom diagnosed with cancer 2 months ago. Needs 45K INR monthly for medical and travel. Currently earning 50K. Can I increase income to 1L or how do I manage this with 23L investments?"],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: 'CUSTOM' as const,
        description: "Mom diagnosed with cancer 2 months ago. Needs 45K INR monthly for medical and travel. Currently earning 50K. Can I increase income to 1L or how do I manage this with 23L investments?",
        target_corpus_lakh: 23.0,
        current_corpus_lakh: 23.0,
        monthly_sip_required_lakh: 0,
        target_date: '2026-06-01'
      }
    ]
  }

  console.log('--- Running Phase 2 (Goal Assessment -> Portfolio Build -> Voting) ---')
  await dhruv.runPhase2(runId, mockUserId, clientData, providedAnswers)

  console.log('--- Pipeline Completed ---')

  const [run] = await dbInstance.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId)).limit(1)
  console.log('Final Status:', run?.status)

  if (run?.status === 'COMPLETED') {
    const [result] = await dbInstance.select().from(schema.pipelineResults).where(eq(schema.pipelineResults.pipelineRunId, runId)).limit(1)
    console.log('\n===== FINAL PORTFOLIO =====\n')
    console.log(JSON.stringify(result?.fullPortfolio, null, 2))
    console.log('\n===========================\n')
  }

  const messages = await dbInstance.select().from(schema.deliberationMessages).where(eq(schema.deliberationMessages.pipelineRunId, runId)).orderBy(schema.deliberationMessages.createdAt)
  
  console.log('\n===== DELIBERATION MESSAGES =====\n')
  messages.forEach((m: any) => {
    console.log(`[${m.sender}] -> [${m.messageType}]`)
    console.log(JSON.stringify(m.payload, null, 2))
    console.log('---')
  })

  await pool.end()
}

main().catch(console.error)
