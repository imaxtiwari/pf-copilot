import { config } from 'dotenv'
config({ path: '.env.local' })

// Override and set environment variables for the mock to succeed
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
      } else if (userMessage.includes('Analyze the following client goal plan assessment') || userMessage.includes('Analyze the following portfolio draft')) {
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
          overall_assessment: "Goal/Portfolio plan has concentration risks."
        })
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
import { Vikram } from '../lib/agents/vikram'
import { Aria } from '../lib/agents/aria'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { AgentMemoryStore } from '../lib/memory/memory-store'
import { WebResearchTool } from '../lib/research/web-research-tool'
import { ClientRiskProfile } from '../lib/agents/types/kiran-types'
import { CritiqueFault } from '../lib/agents/types/aria-types'
import { randomUUID } from 'crypto'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })
  const memoryStore = new AgentMemoryStore()

  console.log('--- STARTING SMOKE TEST FOR STEP 9 ---')

  const vikramResearchTool = new WebResearchTool('VIKRAM', memoryStore, deliberationRoom)
  const ariaResearchTool = new WebResearchTool('ARIA', memoryStore, deliberationRoom)

  const vikram = new Vikram(deliberationRoom, memoryStore, vikramResearchTool, db)
  const aria = new Aria(deliberationRoom, memoryStore, ariaResearchTool, db)

  console.log('Agents instantiated successfully.')

  const clientId = randomUUID()
  const pipelineRunId = randomUUID()

  // Initialize checks status
  let conductInterviewPassed = false
  let assessGoalsAchievablePassed = false
  let assessGoalsRevisedPassed = false
  let assessGoalsImpossiblePassed = false
  let selectFrameworkPassed = false
  let critiqueGoalPlanPassed = false
  let critiquePortfolioPassed = false
  let respondCounterPassed = false

  // 1. Mock ClientRiskProfile
  const mockRiskProfile: ClientRiskProfile = {
    profile_id: randomUUID(),
    client_id: clientId,
    version: 1,
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    age: 32,
    years_to_goal: 15,
    income_stability_score: 8,
    existing_liabilities: null,
    dependants: 'spouse',
    emergency_fund_months: 6,
    insurance_coverage: 'Term life and health active',
    tax_bracket_pct: 30,
    behavioural_risk_tolerance: 'HIGH',
    stated_risk_tolerance: 'HIGH',
    geographic_income_risk: null,
    factors: []
  }

  // 2. Test VIKRAM.conductClientInterview
  console.log('\n2. Testing VIKRAM.conductClientInterview...')
  try {
    const questions = await vikram.conductClientInterview(mockRiskProfile, pipelineRunId)
    console.log(`Generated ${questions.length} questions. Example: "${questions[0]}"`)
    if (questions.length < 15 || questions.length > 25) {
      throw new Error(`Expected between 15 and 25 questions, got ${questions.length}`)
    }
    console.log('✓ conductClientInterview validation passed.')
    conductInterviewPassed = true
  } catch (err) {
    console.error('VIKRAM conductClientInterview failed:', err)
  }

  // 3. Test VIKRAM.assessGoals - Case A: Achievable Goal
  console.log('\n3. Testing VIKRAM.assessGoals (ACHIEVABLE)...')
  const targetDate5y = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString()
  const clientAnswersAchievable = {
    monthly_income_lakh: 3.0,
    stated_goals: ['Retirement plan'],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: 'RETIREMENT',
        description: 'Retirement fund',
        target_corpus_lakh: 150.0,
        current_corpus_lakh: 100.0,
        monthly_sip_required_lakh: 0.5,
        target_date: targetDate5y
      }
    ]
  }

  let achievableAssessment: any
  try {
    achievableAssessment = await vikram.assessGoals('mock-client', 1, clientAnswersAchievable as any, pipelineRunId)
    console.log('Verdict:', achievableAssessment.achievability_verdict)
    console.log('Decomposed Goals CAGR:', achievableAssessment.decomposed_goals[0].required_cagr_pct.toFixed(2) + '%')
    if (achievableAssessment.achievability_verdict !== 'ACHIEVABLE') {
      throw new Error(`Expected verdict to be ACHIEVABLE, got ${achievableAssessment.achievability_verdict}`)
    }
    console.log('✓ assessGoals (ACHIEVABLE) validation passed.')
    assessGoalsAchievablePassed = true
  } catch (err) {
    console.error('VIKRAM assessGoals (ACHIEVABLE) failed:', err)
  }

  // 4. Test VIKRAM.assessGoals - Case B: Revised Goal (CAGR > 20% but <= 30%)
  console.log('\n4. Testing VIKRAM.assessGoals (REVISED)...')
  const targetDate3y = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString()
  const clientAnswersRevised = {
    monthly_income_lakh: 2.0,
    stated_goals: ['Wealth generation'],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: 'WEALTH_CREATION',
        description: 'Short term wealth',
        target_corpus_lakh: 20.0,
        current_corpus_lakh: 10.0, // CAGR ~26%
        monthly_sip_required_lakh: 0.1,
        target_date: targetDate3y
      }
    ]
  }

  try {
    const revisedAssessment = await vikram.assessGoals('mock-client', 1, clientAnswersRevised as any, pipelineRunId)
    console.log('Verdict:', revisedAssessment.achievability_verdict)
    console.log('Revised Plan Preview:', revisedAssessment.revised_plan?.slice(0, 100) + '...')
    if (revisedAssessment.achievability_verdict !== 'REVISED') {
      throw new Error(`Expected verdict to be REVISED, got ${revisedAssessment.achievability_verdict}`)
    }
    console.log('✓ assessGoals (REVISED) validation passed.')
    assessGoalsRevisedPassed = true
  } catch (err) {
    console.error('VIKRAM assessGoals (REVISED) failed:', err)
  }

  // 5. Test VIKRAM.assessGoals - Case C: Impossible Goal (CAGR > 30% or monthly SIP > 100% of income)
  console.log('\n5. Testing VIKRAM.assessGoals (IMPOSSIBLE)...')
  const clientAnswersImpossible = {
    monthly_income_lakh: 1.0,
    stated_goals: ['Quick mansion'],
    answers: {},
    goals_data: [
      {
        goal_id: randomUUID(),
        goal_type: 'HOME_PURCHASE',
        description: 'Mansion buy',
        target_corpus_lakh: 50.0,
        current_corpus_lakh: 1.0, // CAGR ~190% over 2 years
        monthly_sip_required_lakh: 2.5, // 2.5L SIP on 1L income!
        target_date: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  }

  try {
    const impossibleAssessment = await vikram.assessGoals('mock-client', 1, clientAnswersImpossible as any, pipelineRunId)
    console.log('Verdict:', impossibleAssessment.achievability_verdict)
    if (impossibleAssessment.achievability_verdict !== 'IMPOSSIBLE') {
      throw new Error(`Expected verdict to be IMPOSSIBLE, got ${impossibleAssessment.achievability_verdict}`)
    }
    console.log('✓ assessGoals (IMPOSSIBLE) validation passed.')
    assessGoalsImpossiblePassed = true
  } catch (err) {
    console.error('VIKRAM assessGoals (IMPOSSIBLE) failed:', err)
  }

  // 6. Test VIKRAM.selectStrategyFramework
  console.log('\n6. Testing VIKRAM.selectStrategyFramework...')
  try {
    const framework = await vikram.selectStrategyFramework(achievableAssessment, mockRiskProfile, pipelineRunId)
    console.log('Selected frameworks:', framework.selected_frameworks.map(f => f.name))
    console.log('Guidance asset allocation:', framework.asset_allocation_guidance)
    console.log('✓ selectStrategyFramework validation passed.')
    selectFrameworkPassed = true
  } catch (err) {
    console.error('VIKRAM selectStrategyFramework failed:', err)
  }

  // 7. Test ARIA.critiqueGoalPlan
  console.log('\n7. Testing ARIA.critiqueGoalPlan...')
  try {
    const critique = await aria.critiqueGoalPlan(achievableAssessment, pipelineRunId)
    console.log('Critique faults found:', critique.faults.length)
    if (critique.faults.length > 0) {
      console.log('Example fault description:', critique.faults[0].fault_description)
      console.log('Example fault category:', critique.faults[0].fault_category)
      console.log('Example fault severity:', critique.faults[0].severity)
    }
    console.log('✓ critiqueGoalPlan validation passed.')
    critiqueGoalPlanPassed = true
  } catch (err) {
    console.error('ARIA critiqueGoalPlan failed:', err)
  }

  // 8. Test ARIA.critiquePortfolioDraft
  console.log('\n8. Testing ARIA.critiquePortfolioDraft...')
  const mockPortfolioDraft = {
    draft_version: 1,
    allocations: [
      { scheme_code: '119551', weight_pct: 80 },
      { scheme_code: '119552', weight_pct: 20 }
    ]
  }
  try {
    const critique = await aria.critiquePortfolioDraft(mockPortfolioDraft, { message_id: randomUUID(), client_id: clientId }, pipelineRunId)
    console.log('Overall assessment:', critique.overall_assessment)
    console.log('✓ critiquePortfolioDraft validation passed.')
    critiquePortfolioPassed = true
  } catch (err) {
    console.error('ARIA critiquePortfolioDraft failed:', err)
  }

  // 9. Test ARIA.respondToCounterArgument
  console.log('\n9. Testing ARIA.respondToCounterArgument...')
  const originalFault: CritiqueFault = {
    fault_id: randomUUID(),
    fault_category: 'CONCENTRATION',
    fault_description: 'The portfolio is heavily concentrated in a single large-cap IT index fund (80% allocation), introducing significant sector-specific volatility.',
    evidence_sources: [{ url: 'https://sebi.gov.in', excerpt_summary: 'SEBI concentration warning', retrieved_at: new Date().toISOString() }],
    severity: 'MAJOR',
    suggested_remedy: 'Diversify into active mid-cap or debt categories to reduce concentration.',
    confidence_tier: 'VERIFIED',
    from_fault_library: false
  }

  try {
    const response = await aria.respondToCounterArgument(
      originalFault,
      'The client specifically requested high exposure to tech because they work in IT and want to double down on their sector knowledge.',
      pipelineRunId
    )
    console.log('Aria response (updated fault):')
    console.log('- Severity:', response.severity)
    console.log('- Description:', response.fault_description)
    console.log('✓ respondToCounterArgument validation passed.')
    respondCounterPassed = true
  } catch (err) {
    console.error('ARIA respondToCounterArgument failed:', err)
  }

  const allPassed =
    conductInterviewPassed &&
    assessGoalsAchievablePassed &&
    assessGoalsRevisedPassed &&
    assessGoalsImpossiblePassed &&
    selectFrameworkPassed &&
    critiqueGoalPlanPassed &&
    critiquePortfolioPassed &&
    respondCounterPassed

  if (allPassed) {
    console.log('\n✓ ALL STEP 9 SMOKE TEST CHECKS PASSED')
  } else {
    console.error('\n✗ SOME CHECKS FAILED')
    process.exit(1)
  }

  await pool.end()
}

main().catch((e) => {
  console.error('Smoke test failed with fatal error:', e)
  process.exit(1)
})
