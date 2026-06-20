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

  // 1b. Seed CAS Holdings
  const casUploadId = randomUUID()
  await dbInstance.insert(schema.casUploads).values({
    id: casUploadId,
    userId: mockUserId,
    fileHash: 'mock-hash-niti-gupta',
    status: 'processed',
    visionUsed: false
  }).onConflictDoNothing()

  const mockHoldings = [
    { schemeCode: '120465', schemeName: 'Axis Bluechip Fund - Direct Growth', folioNumber: 'F1', units: '1000', nav: '50', marketValue: '50000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '112323', schemeName: 'Axis Long Term Equity Fund - Direct Growth (ELSS)', folioNumber: 'F2', units: '500', nav: '80', marketValue: '40000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '125354', schemeName: 'Axis Small Cap Fund - Direct Growth', folioNumber: 'F3', units: '800', nav: '70', marketValue: '56000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '120466', schemeName: 'Axis Liquid Fund - Direct Growth', folioNumber: 'F4', units: '2000', nav: '100', marketValue: '200000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '120823', schemeName: 'Quant Active Fund - Direct Growth', folioNumber: 'F5', units: '300', nav: '120', marketValue: '36000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '120828', schemeName: 'Quant Small Cap Fund - Direct Growth', folioNumber: 'F6', units: '400', nav: '110', marketValue: '44000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId },
    { schemeCode: '122639', schemeName: 'Parag Parikh Flexi Cap Fund - Direct Growth', folioNumber: 'F7', units: '600', nav: '90', marketValue: '54000', asOfDate: new Date().toISOString(), source: 'manual' as const, casUploadId }
  ]

  for (const holding of mockHoldings) {
    await dbInstance.insert(schema.portfolioHoldings).values({
      userId: mockUserId,
      ...holding
    })
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

  const providedAnswers = {
    monthly_income_lakh: 1.2,
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
        goal_type: 'CHILD_EDUCATION' as const,
        description: "Child's higher education — ₹50L corpus in 14 years",
        target_corpus_lakh: 50.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 14, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: 'HOME_PURCHASE' as const,
        description: "Own apartment down payment — ₹30L in 6 years",
        target_corpus_lakh: 30.0,
        current_corpus_lakh: 0.0,
        monthly_sip_required_lakh: 0,
        target_date: new Date(new Date().getFullYear() + 6, 0, 1).toISOString()
      },
      {
        goal_id: randomUUID(),
        goal_type: 'RETIREMENT' as const,
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
