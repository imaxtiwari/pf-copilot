import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { Soma } from '../lib/agents/soma'
import { Kiran } from '../lib/agents/kiran'
import { checkFundDataFreshness } from '../lib/agents/soma-data-checker'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { AgentMemoryStore } from '../lib/memory/memory-store'
import { WebResearchTool } from '../lib/research/web-research-tool'
import logger from '../lib/logger'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })
  const memoryStore = new AgentMemoryStore()

  console.log('--- STARTING SMOKE TEST FOR STEP 8 ---')

  // 1. Test SOMA freshness checker
  console.log('\n1. Testing checkFundDataFreshness...')
  const testCodes = ['119551', '999999'] // '119551' exists, '999999' is invalid
  const freshnessReport = await checkFundDataFreshness(testCodes)
  console.log('Freshness report:', JSON.stringify(freshnessReport, null, 2))

  // 2. Instantiate SOMA and KIRAN agents
  console.log('\n2. Instantiating SOMA and KIRAN agents...')
  const somaResearchTool = new WebResearchTool('SOMA', memoryStore, deliberationRoom)
  const kiranResearchTool = new WebResearchTool('KIRAN', memoryStore, deliberationRoom)

  const soma = new Soma(deliberationRoom, memoryStore, somaResearchTool, db)
  const kiran = new Kiran(deliberationRoom, memoryStore, kiranResearchTool, db)

  console.log('Agents instantiated successfully.')

  // 3. Test SOMA getFundProfile
  console.log('\n3. Testing SOMA.getFundProfile for scheme 119551...')
  try {
    const profile = await soma.getFundProfile('119551', 'SMOKE_RUN_SOMA')
    console.log('SOMA Fund Profile (Validated):', JSON.stringify(profile, null, 2))
  } catch (err) {
    console.error('SOMA getFundProfile failed (expected if keys missing):', String(err))
  }

  // 4. Test KIRAN runDailyMacroScan
  console.log('\n4. Testing KIRAN.runDailyMacroScan...')
  try {
    const bulletin = await kiran.runDailyMacroScan('SMOKE_RUN_KIRAN')
    console.log('KIRAN Macro Bulletin (Validated):', JSON.stringify(bulletin, null, 2))
  } catch (err) {
    console.error('KIRAN runDailyMacroScan failed (expected if keys missing):', String(err))
  }

  // 5. Test KIRAN buildClientRiskProfile
  console.log('\n5. Testing KIRAN.buildClientRiskProfile...')
  try {
    const riskProfile = await kiran.buildClientRiskProfile(
      '00000000-0000-0000-0000-000000000000',
      {
        age: 35,
        yearsToGoal: 10,
        cityTier: 'metro',
        dependents: 'spouse',
        monthlyRent: 25000,
        medicalConditions: true,
        taxBracketPct: 30,
        version: 1,
      },
      'SMOKE_RUN_KIRAN'
    )
    console.log('KIRAN Client Risk Profile (Validated):', JSON.stringify(riskProfile, null, 2))
  } catch (err) {
    console.error('KIRAN buildClientRiskProfile failed (expected if keys missing):', String(err))
  }

  console.log('\n--- SMOKE TEST COMPLETE ---')
  await pool.end()
}

main().catch((e) => {
  console.error('Smoke test failed with fatal error:', e)
  process.exit(1)
})
