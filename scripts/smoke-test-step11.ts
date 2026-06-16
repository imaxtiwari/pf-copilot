import { config } from 'dotenv'
config({ path: '.env.local' })

// Set environment variables for the mock to succeed
process.env.AZURE_OPENAI_ENDPOINT = 'https://mock-endpoint.openai.azure.com/'
process.env.AZURE_OPENAI_API_KEY = 'mock-key'
process.env.AZURE_OPENAI_API_VERSION = '2024-08-01-preview'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O = 'gpt-4o'
process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI = 'gpt-4o-mini'
process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING = 'text-embedding-3-small'
process.env.TAVILY_API_KEY = 'mock-key'
process.env.QDRANT_URL = 'http://localhost:6333'
process.env.QDRANT_API_KEY = 'mock-key'

// Intercept global fetch to mock Azure OpenAI, Qdrant, and Tavily
const originalFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString()

  // 1. Azure OpenAI Requests
  if (urlStr.includes('openai.azure.com')) {
    const bodyStr = init?.body ? init.body.toString() : ''
    const body = bodyStr ? JSON.parse(bodyStr) : {}

    // Embeddings
    if (urlStr.includes('/embeddings')) {
      return new Response(JSON.stringify({
        data: [{ embedding: new Array(1536).fill(0) }],
        usage: { prompt_tokens: 5 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Chat completions
    if (urlStr.includes('/chat/completions')) {
      const messages = body.messages || []
      const systemMessage = messages.find((m: any) => m.role === 'system')?.content || ''
      const userMessage = messages.find((m: any) => m.role === 'user')?.content || ''

      let mockResponse = '{}'

      if (userMessage.includes('Generate a list of 15 to 25 client interview questions')) {
        mockResponse = JSON.stringify([
          "What is your target investment horizon for each goal?",
          "How much do you plan to increase your monthly SIP contribution annually?",
          "Do you have any near-term liquid needs in the next 12-24 months?",
          "Would you consider dynamic asset allocation to mitigate drawdowns?",
          "What percentage of your current portfolio is in fixed deposit?",
          "Are there any specific tax exemptions you plan to claim?",
          "How do you plan to fund emergency cash needs?",
          "Do you have dependency on parental inheritance?",
          "Is a home purchase goal flexible in terms of timeline?",
          "What is your current allocation to physical real estate?",
          "Are you comfortable with international equity index exposure?",
          "How would you react to a 20% drawdown in your equity portfolio?",
          "Is the child higher education goal domestic or international?",
          "Do you have active business income or salaried income?",
          "What is your current medical insurance coverage limit?",
          "Do you plan to keep any gold allocations in physical or digital format?"
        ])
      } else if (userMessage.includes('Formulate a revised investment plan')) {
        mockResponse = "Since the original CAGR and monthly SIP expectations are unrealistic, we propose: 1. Reduce the emergency fund target slightly or extend the vacation goal timeline from 2 to 4 years. 2. Increase current monthly SIP to 0.4L. 3. Expect a realistic 12% equity CAGR instead of 25%."
      } else if (userMessage.includes('Select the most appropriate investment strategy frameworks')) {
        mockResponse = JSON.stringify({
          selected_frameworks: [
            {
              name: "Core-Satellite Framework",
              description: "Puts 70% in low-cost index funds and 30% in active themes.",
              why_applicable: "Matches the client's high risk tolerance and long-term targets.",
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
      } else if (userMessage.includes('Analyze the following client goal plan assessment')) {
        mockResponse = JSON.stringify({
          faults: [],
          overall_assessment: "Goal plan looks viable."
        })
      } else if (userMessage.includes('Analyze the following portfolio draft')) {
        // First draft has IT concentration fault, revised doesn't
        if (userMessage.includes('"revision_number": 0') || userMessage.includes('119551')) {
          mockResponse = JSON.stringify({
            faults: [
              {
                fault_category: "CONCENTRATION",
                fault_description: "Overweight in IT index fund (80% allocation) is risky.",
                evidence_sources: [
                  { "url": "https://sebi.gov.in", "excerpt_summary": "SEBI concentration limit guidelines" }
                ],
                severity: "MAJOR",
                suggested_remedy: "Reallocate 20% to mid-caps.",
                confidence_tier: "VERIFIED"
              }
            ],
            overall_assessment: "Portfolio has concentration risks."
          })
        } else {
          mockResponse = JSON.stringify({
            faults: [],
            overall_assessment: "Revised portfolio looks well diversified."
          })
        }
      } else if (userMessage.includes('Respond to the client or agent\'s counter-argument')) {
        mockResponse = JSON.stringify({
          fault_category: "CONCENTRATION",
          fault_description: "Defended concentration fault due to sector-specific client preference.",
          evidence_sources: [
            { "url": "https://sebi.gov.in", "excerpt_summary": "SEBI advisory warning." }
          ],
          severity: "MINOR",
          suggested_remedy: "Consider gradual rebalancing.",
          confidence_tier: "VERIFIED"
        })
      } else if (userMessage.includes('Generate a goal bucket list and specific mutual fund allocations')) {
        // Priya build portfolio response
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
              fund_name: "360 ONE ELSS Tax Saver Nifty 50 Index Fund",
              isin: "INF846K01DP8",
              scheme_code: "151165",
              allocation_pct: 80,
              goal_bucket_id: "00000000-0000-4000-8000-000000000001",
              rationale: "Core index fund matching Vikram guidance.",
              source_url: "https://sebi.gov.in"
            },
            {
              allocation_id: "00000000-0000-4000-8000-000000000003",
              fund_name: "Mock Active Debt Fund",
              isin: "INF846K01DP9",
              scheme_code: "119551",
              allocation_pct: 20,
              goal_bucket_id: "00000000-0000-4000-8000-000000000001",
              rationale: "Satellite debt allocation for stability.",
              source_url: "https://sebi.gov.in"
            }
          ]
        })
      } else if (userMessage.includes('You are revising a previously generated portfolio')) {
        // Priya revise portfolio response (diversified)
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
              fund_name: "360 ONE ELSS Tax Saver Nifty 50 Index Fund",
              isin: "INF846K01DP8",
              scheme_code: "151165",
              allocation_pct: 50, // Reduced from 80% to fix concentration risk
              goal_bucket_id: "00000000-0000-4000-8000-000000000001",
              rationale: "Core index allocation.",
              source_url: "https://sebi.gov.in"
            },
            {
              allocation_id: "00000000-0000-4000-8000-000000000003",
              fund_name: "Mock Active Debt Fund",
              isin: "INF846K01DP9",
              scheme_code: "119551",
              allocation_pct: 50, // Increased to 50%
              goal_bucket_id: "00000000-0000-4000-8000-000000000001",
              rationale: "Stable debt allocation.",
              source_url: "https://sebi.gov.in"
            }
          ]
        })
      } else if (userMessage.includes('Generate a concise executive summary for the client\'s final portfolio')) {
        // Dhruv executive summary response
        mockResponse = "Based on the client's moderate risk profile and 10-year investment horizon, the committee has approved a Core-Satellite portfolio design. 50% is allocated to a low-cost Nifty 50 Index Fund to capture market growth, and 50% is in a secure Active Debt Fund to provide steady yields and capital hedging."
      }

      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: mockResponse } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // 2. Qdrant Requests
  if (urlStr.includes(':6333')) {
    if (urlStr.includes('/collections/')) {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ result: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/points/search')) {
        return new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/points')) {
        return new Response(JSON.stringify({ result: { operation_id: 0, status: 'completed' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    if (urlStr.includes('/collections')) {
      return new Response(JSON.stringify({ result: { collections: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // 3. Tavily Requests
  if (urlStr.includes('api.tavily.com')) {
    return new Response(JSON.stringify({
      results: [
        {
          title: "SEBI Portfolio Guidelines",
          url: "https://sebi.gov.in",
          content: "Investment guidelines suggest diversification across asset classes to manage market cycles."
        }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  return originalFetch(input, init)
}

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { Dhruv } from '../lib/agents/dhruv'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { AgentMemoryStore } from '../lib/memory/memory-store'
import { WebResearchTool } from '../lib/research/web-research-tool'
import { randomUUID } from 'crypto'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })
  const memoryStore = new AgentMemoryStore()

  console.log('--- STARTING SMOKE TEST FOR STEP 11 ---')

  const dhruvResearchTool = new WebResearchTool('DHRUV', memoryStore, deliberationRoom)
  const dhruv = new Dhruv(deliberationRoom, memoryStore, dhruvResearchTool, db)

  console.log('Dhruv agent instantiated successfully.')

  const clientId = randomUUID()
  const clientData = {
    age: 35,
    yearsToGoal: 10,
    cityTier: 'metro',
    dependents: 'spouse',
    monthlyRent: 25000,
    medicalConditions: false,
    taxBracketPct: 30,
    monthly_income_lakh: 3.0,
    stated_goals: ['Retirement fund'],
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

  // 0. Pre-insert mock user to satisfy foreign key constraint
  try {
    await db.insert(schema.users).values({ id: clientId }).onConflictDoNothing()
  } catch (err) {
    // Ignore conflict if it exists
  }

  // 1. Test Dhruv.startPipeline
  console.log('\n1. Testing Dhruv.startPipeline...')
  let pipelineRunId = ''
  try {
    pipelineRunId = await dhruv.startPipeline(clientId, clientData)
    console.log('Pipeline started. Pipeline Run ID:', pipelineRunId)
    if (!pipelineRunId) throw new Error('Failed to generate pipeline run ID')
    console.log('✓ startPipeline validation passed.')
  } catch (err) {
    console.error('Dhruv.startPipeline failed:', err)
    process.exit(1)
  }

  // 2. Test Dhruv.runFullPipeline
  console.log('\n2. Testing Dhruv.runFullPipeline (End-to-End Orchestration)...')
  try {
    const result = await dhruv.runFullPipeline(pipelineRunId, clientId, clientData)
    
    // Check if result is a final portfolio packet
    if ('packet_id' in result) {
      console.log('Pipeline completed successfully with FinalPortfolioPacket!')
      console.log('- Packet ID:', result.packet_id)
      console.log('- Executive Summary:', result.executive_summary)
      console.log('- Achievability Verdict:', result.achievability_verdict)
      console.log('- Full Portfolio Status:', result.full_portfolio.status)
      console.log('- Portfolio Confidence Score:', result.confidence_score_breakdown.total)
      console.log('- Backtest CAGR:', result.backtest_summary.portfolio_cagr_pct.toFixed(2) + '%')
      console.log('- SEBI Disclaimer present:', !!result.sebi_disclaimer)
      console.log('- Validity Disclaimer present:', !!result.validity_disclosure)
      
      // Assertions
      if (result.confidence_score_breakdown.total < 60) {
        throw new Error('Approved portfolio has confidence score below 60!')
      }
      console.log('✓ runFullPipeline (Approval path) validation passed.')
    } else {
      console.log('Pipeline completed with DeadlockReport:', result)
    }
  } catch (err) {
    console.error('Dhruv.runFullPipeline failed:', err)
    process.exit(1)
  }

  // 3. Test Dhruv.runWeeklyKnowledgeConsolidation
  console.log('\n3. Testing Dhruv.runWeeklyKnowledgeConsolidation...')
  try {
    await dhruv.runWeeklyKnowledgeConsolidation()
    console.log('✓ runWeeklyKnowledgeConsolidation validation passed.')
  } catch (err) {
    console.error('Dhruv.runWeeklyKnowledgeConsolidation failed:', err)
    process.exit(1)
  }

  console.log('\n--- SMOKE TEST COMPLETE ---')
  await pool.end()
}

main().catch((e) => {
  console.error('Smoke test failed with fatal error:', e)
  process.exit(1)
})
