import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'
config({ path: '.env.local' })

// Set mock environment variables
process.env.AZURE_OPENAI_ENDPOINT = 'https://mock-endpoint.openai.azure.com/'
process.env.AZURE_OPENAI_API_KEY = 'mock-key'
process.env.AZURE_OPENAI_API_VERSION = '2024-08-01-preview'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O = 'gpt-4o'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'gpt-4o-mini'
process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING = 'text-embedding-3-small'
process.env.TAVILY_API_KEY = 'mock-key'
process.env.QDRANT_URL = 'http://localhost:6333'
process.env.QDRANT_API_KEY = 'mock-key'

// Mock authentication helper
vi.mock('@/lib/auth/dev-user', () => {
  return {
    resolveOrCreateUserId: async () => ({
      userId: '00000000-0000-0000-0000-000000000000',
      isNew: false
    }),
    COOKIE_NAME: 'pf_user_id',
    cookieOptions: () => ({})
  }
})

vi.mock('next/headers', () => {
  return {
    cookies: () => ({
      get: () => ({ value: '00000000-0000-0000-0000-000000000000' }),
      set: () => {}
    })
  }
})

// Intercept global fetch to mock Azure OpenAI, Qdrant, and Tavily
const originalFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString()

  if (urlStr.includes('openai.azure.com')) {
    const bodyStr = init?.body ? init.body.toString() : ''
    const body = bodyStr ? JSON.parse(bodyStr) : {}

    if (urlStr.includes('/embeddings')) {
      const useBase64 = body.encoding_format === 'base64' || !body.encoding_format
      const embedding = useBase64 ? Buffer.alloc(1536 * 4).toString('base64') : new Array(1536).fill(0)
      return new Response(JSON.stringify({
        data: [{ embedding }],
        usage: { prompt_tokens: 5 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (urlStr.includes('/chat/completions')) {
      const messages = body.messages || []
      const userMessage = messages.find((m: any) => m.role === 'user')?.content || ''

      let mockResponse = '{}'

      if (userMessage.includes('Generate a list of 15 to 25 client interview questions')) {
        mockResponse = JSON.stringify([
          "What is your target investment horizon for each goal?",
          "How much do you plan to increase your monthly SIP contribution annually?",
          "Do you have any near-term liquid needs in the next 12-24 months?"
        ])
      } else if (userMessage.includes('Formulate a revised investment plan')) {
        mockResponse = "Since the original CAGR and monthly SIP expectations are unrealistic, we propose re-adjusting target dates."
      } else if (userMessage.includes('Select the most appropriate investment strategy frameworks')) {
        mockResponse = JSON.stringify({
          selected_frameworks: [
            {
              name: "Core-Satellite Framework",
              description: "Puts 70% in low-cost index funds and 30% in active themes.",
              why_applicable: "Matches the client's risk tolerance.",
              source_url: "https://sebi.gov.in"
            }
          ],
          asset_allocation_guidance: {
            equity_pct_range: [60, 80],
            debt_pct_range: [10, 20],
            gold_pct_range: [5, 10],
            international_pct_range: [5, 10]
          }
        })
      } else if (userMessage.includes('Create a risk hedge scenario and contingency plan')) {
        mockResponse = JSON.stringify({
          risk_scenario: "If market rates rise, this allocation will yield higher returns.",
          hedge_instrument: "Short-term debt funds indexation.",
          hedge_rationale: "Mitigates long-term interest rate risk.",
          contingency_if_hedge_fails: "Move to overnight liquid funds."
        })
      } else if (userMessage.includes('Estimate the portfolio-level impact under the scenario')) {
        mockResponse = JSON.stringify({
          estimated_portfolio_return_pct: -10.5,
          worst_case_drawdown_pct: 15.0,
          recovery_timeline_months: 6,
          most_affected_funds: [],
          stress_rationale: "Portfolio is well hedged with debt allocation."
        })
      } else if (userMessage.includes('Analyze the following client goal plan assessment')) {
        mockResponse = JSON.stringify({
          faults: [],
          overall_assessment: "Goal plan looks viable."
        })
      } else if (userMessage.includes('Analyze the following portfolio draft')) {
        mockResponse = JSON.stringify({
          faults: [],
          overall_assessment: "Portfolio looks well diversified."
        })
      } else if (userMessage.includes('Generate a goal bucket list and specific mutual fund allocations')) {
        mockResponse = JSON.stringify({
          goal_buckets: [
            {
              bucket_id: "00000000-0000-4000-8000-000000000001",
              goal_id: "11111111-1111-4111-8111-111111111111",
              goal_type: "RETIREMENT",
              target_corpus_lakh: 100,
              target_date: "2036-06-16",
              time_horizon_years: 10,
              risk_profile: "MODERATE",
              allocation_pct: 100
            }
          ],
          fund_allocations: [
            {
              allocation_id: "00000000-0000-4000-8000-000000000002",
              fund_name: "Mock Active Debt Fund",
              isin: "INF846K01DP9",
              scheme_code: "119551",
              allocation_pct: 100,
              goal_bucket_id: "00000000-0000-4000-8000-000000000001",
              rationale: "Core index fund matching Vikram guidance.",
              source_url: "https://sebi.gov.in"
            }
          ]
        })
      } else if (userMessage.includes('Generate a concise executive summary for the client\'s final portfolio')) {
        mockResponse = "Mock final portfolio recommendation executive summary."
      } else if (userMessage.includes('compile the daily 8-point MacroRiskBulletin')) {
        mockResponse = JSON.stringify({
          risk_level: "LOW",
          rbi_policy_signal: "STABLE",
          fed_signal: "STABLE",
          india_vix: 13.5,
          india_vix_trend: "STABLE",
          brent_crude_usd: 82.0,
          gold_mcx_inr: 72000.0,
          usdinr_rate: 83.4,
          usdinr_trend: "STABLE",
          fii_net_flow_cr: 150.0,
          geopolitical_alerts: [],
          key_risks: ["Inflation risk"],
          key_observations: ["Good growth numbers"]
        })
      } else if (userMessage.includes('respond with OK')) {
        mockResponse = "OK"
      }

      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: mockResponse } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (urlStr.includes(':6333')) {
    if (urlStr.includes('/collections/')) {
      if (urlStr.includes('/points/search')) {
        return new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ result: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (urlStr.includes('/collections')) {
      return new Response(JSON.stringify({ result: { collections: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (urlStr.includes('api.tavily.com')) {
    return new Response(JSON.stringify({
      results: [
        {
          title: "SEBI Portfolio Guidelines",
          url: "https://sebi.gov.in",
          content: "Investment guidelines suggest diversification."
        }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  return originalFetch(input, init)
}

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'

// Import route handlers
import { POST as startPipelineHandler } from '../app/api/pipeline/start/route'
import { GET as getStatusHandler } from '../app/api/pipeline/[runId]/status/route'
import { POST as submitInterviewHandler } from '../app/api/pipeline/[runId]/interview/route'
import { GET as getDeliberationHandler } from '../app/api/pipeline/[runId]/deliberation/route'
import { GET as getResultHandler } from '../app/api/pipeline/[runId]/result/route'
import { GET as getAuditHandler } from '../app/api/audit/route'
import { GET as getMacroBulletinHandler } from '../app/api/macro-bulletin/route'
import { GET as getHealthHandler } from '../app/api/health/route'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { agentMemoryStore } from '../lib/memory/memory-store'
import { WebResearchTool } from '../lib/research/web-research-tool'

describe('Step 13 Integration Smoke Tests', () => {
  let pool: Pool
  let dbInstance: any
  const clientId = '00000000-0000-0000-0000-000000000000'
  let pipelineRunId = ''

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
    dbInstance = drizzle(pool, { schema })

    // Clean up past runs/profiles for this mock user
    const userRuns = await dbInstance
      .select({ runId: schema.pipelineRuns.runId })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.clientId, clientId))
    
    const runIds = userRuns.map((r: any) => r.runId)
    if (runIds.length > 0) {
      const { inArray } = await import('drizzle-orm')
      await dbInstance.delete(schema.deliberationMessages).where(inArray(schema.deliberationMessages.pipelineRunId, runIds))
      await dbInstance.delete(schema.pipelineResults).where(inArray(schema.pipelineResults.pipelineRunId, runIds))
      await dbInstance.delete(schema.committeeVotes).where(inArray(schema.committeeVotes.pipelineRunId, runIds))
      await dbInstance.delete(schema.portfolioDrafts).where(inArray(schema.portfolioDrafts.pipelineRunId, runIds))
    }

    await dbInstance.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.clientId, clientId))
    await dbInstance.delete(schema.userProfile).where(eq(schema.userProfile.userId, clientId))
    await dbInstance.delete(schema.users).where(eq(schema.users.id, clientId))

    // Seed mock user and profile
    await dbInstance.insert(schema.users).values({ id: clientId }).onConflictDoNothing()
    await dbInstance.insert(schema.userProfile).values({
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
  })

  afterAll(async () => {
    await pool.end()
  })

  it('should successfully execute the full pipeline flow via HTTP route handlers', async () => {
    // 1. POST /api/pipeline/start
    console.log('--- TEST: POST /api/pipeline/start ---')
    const startBody = {
      client_data: {
        age: 35,
        city_tier: 'metro',
        monthly_rent: 25000,
        owns_home: false,
        dependents: 'spouse',
        medical_conditions: true
      }
    }
    const startReq = new Request('http://localhost:3000/api/pipeline/start', {
      method: 'POST',
      body: JSON.stringify(startBody)
    })
    const startRes = await startPipelineHandler(startReq as any)
    expect(startRes.status).toBe(200)

    const startJson = await startRes.json()
    expect(startJson.status).toBe('STARTED')
    expect(startJson.pipeline_run_id).toBeDefined()
    pipelineRunId = startJson.pipeline_run_id

    // 2. Poll GET /api/pipeline/[runId]/status until stage becomes VIKRAM_INTERVIEW
    console.log('--- TEST: GET /api/pipeline/[runId]/status (polling) ---')
    let currentStage = ''
    for (let i = 0; i < 20; i++) {
      const statusReq = new Request(`http://localhost:3000/api/pipeline/${pipelineRunId}/status`)
      const statusRes = await getStatusHandler(statusReq as any, { params: Promise.resolve({ runId: pipelineRunId }) })
      expect(statusRes.status).toBe(200)

      const statusJson = await statusRes.json()
      currentStage = statusJson.current_stage
      if (currentStage === 'PROFILING_AND_GOAL_ASSESSMENT') {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    expect(currentStage).toBe('PROFILING_AND_GOAL_ASSESSMENT')

    // 3. POST /api/pipeline/[runId]/interview
    console.log('--- TEST: POST /api/pipeline/[runId]/interview ---')
    const interviewBody = {
      answers: {
        "monthly_income_lakh": "3.5",
        "stated_goals": "Retirement corpus"
      }
    }
    const interviewReq = new Request(`http://localhost:3000/api/pipeline/${pipelineRunId}/interview`, {
      method: 'POST',
      body: JSON.stringify(interviewBody)
    })
    const interviewRes = await submitInterviewHandler(interviewReq as any, { params: Promise.resolve({ runId: pipelineRunId }) })
    expect(interviewRes.status).toBe(200)

    const interviewJson = await interviewRes.json()
    expect(interviewJson.stage).toBe('SOMA_FUND_UNIVERSE')

    // 4. Poll status until completed (APPROVED or DEADLOCKED)
    console.log('--- TEST: GET /api/pipeline/[runId]/status (polling completion) ---')
    let finalStatus = ''
    for (let i = 0; i < 30; i++) {
      const statusReq = new Request(`http://localhost:3000/api/pipeline/${pipelineRunId}/status`)
      const statusRes = await getStatusHandler(statusReq as any, { params: Promise.resolve({ runId: pipelineRunId }) })
      expect(statusRes.status).toBe(200)

      const statusJson = await statusRes.json()
      finalStatus = statusJson.status
      if (finalStatus === 'COMPLETED' || finalStatus === 'DEADLOCKED') {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    expect(['COMPLETED', 'DEADLOCKED']).toContain(finalStatus)

    // 5. GET /api/pipeline/[runId]/result
    console.log('--- TEST: GET /api/pipeline/[runId]/result ---')
    const resultReq = new Request(`http://localhost:3000/api/pipeline/${pipelineRunId}/result`)
    const resultRes = await getResultHandler(resultReq as any, { params: Promise.resolve({ runId: pipelineRunId }) })
    expect(resultRes.status).toBe(200)

    const resultJson = await resultRes.json()
    if (finalStatus === 'COMPLETED') {
      expect(resultJson.packet_id).toBeDefined()
      expect(resultJson.full_portfolio).toBeDefined()
    } else {
      expect(resultJson.report_id).toBeDefined()
      expect(resultJson.dhruv_compromise_proposal).toBeDefined()
    }

    // 6. GET /api/pipeline/[runId]/deliberation
    console.log('--- TEST: GET /api/pipeline/[runId]/deliberation ---')
    const delibReq = new Request(`http://localhost:3000/api/pipeline/${pipelineRunId}/deliberation`)
    const delibRes = await getDeliberationHandler(delibReq as any, { params: Promise.resolve({ runId: pipelineRunId }) })
    expect(delibRes.status).toBe(200)

    const delibJson = await delibRes.json()
    expect(delibJson.messages).toBeDefined()
    expect(delibJson.total).toBeGreaterThan(0)
    // Verify each message has oracle_validation
    delibJson.messages.forEach((m: any) => {
      expect(m.oracle_validation).toBeDefined()
      expect(m.sender).toBeDefined()
    })

    // 7. GET /api/audit
    console.log('--- TEST: GET /api/audit ---')
    const auditReq = new Request(`http://localhost:3000/api/audit?pipeline_run_id=${pipelineRunId}`)
    const auditRes = await getAuditHandler(auditReq as any)
    expect(auditRes.status).toBe(200)

    const auditJson = await auditRes.json()
    expect(auditJson.logs).toBeDefined()
    expect(auditJson.total).toBeGreaterThan(0)

    // 8. GET /api/macro-bulletin
    console.log('--- TEST: GET /api/macro-bulletin ---')
    // First trigger daily scan to cache bulletin
    const { Kiran: KiranAgent } = await import('../lib/agents/kiran')
    const kiran = new KiranAgent(deliberationRoom, agentMemoryStore, new WebResearchTool('KIRAN', agentMemoryStore, deliberationRoom), dbInstance)
    await kiran.runDailyMacroScan(pipelineRunId)

    const macroReq = new Request('http://localhost:3000/api/macro-bulletin')
    const macroRes = await getMacroBulletinHandler(macroReq as any)
    expect(macroRes.status).toBe(200)

    const macroJson = await macroRes.json()
    expect(macroJson.risk_level).toBeDefined()
    expect(macroJson.india_vix).toBeDefined()

    // 9. GET /api/health
    console.log('--- TEST: GET /api/health ---')
    const healthReq = new Request('http://localhost:3000/api/health')
    const healthRes = await getHealthHandler()
    if (healthRes.status !== 200) {
      console.error('Health Check Failed. Response:', JSON.stringify(await healthRes.json(), null, 2))
    }
    expect(healthRes.status).toBe(200)

    const healthJson = await healthRes.json()
    expect(healthJson.ok).toBe(true)
    expect(healthJson.data.qdrant_connected).toBe(true)
    expect(healthJson.data.audit_trail_accessible).toBe(true)
    expect(healthJson.data.scheduler_running).toBeDefined()
    expect(healthJson.data.latest_macro_bulletin_age_days).toBeLessThan(1)
  }, 60000)
})
