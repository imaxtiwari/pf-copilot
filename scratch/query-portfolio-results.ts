import { db } from '../lib/db'
import * as schema from '../db/schema'
import { desc } from 'drizzle-orm'

async function main() {
  console.log('🔍 Fetching all portfolio recommendations from pipeline results...')
  const results = await db
    .select()
    .from(schema.pipelineResults)
    .orderBy(desc(schema.pipelineResults.createdAt))

  if (results.length === 0) {
    console.log('No pipeline results found.')
    return
  }

  for (const res of results) {
    const data = res.data as any
    console.log(`\n==================================================`)
    console.log(`Run ID: ${res.pipelineRunId}`)
    console.log(`Result Type: ${res.resultType}`)
    console.log(`Timestamp: ${res.createdAt}`)
    console.log(`==================================================`)
    
    // Check if there are allocations in data
    const allocations = data.portfolio_recommendation?.fund_allocations || data.fund_allocations
    if (allocations && Array.isArray(allocations)) {
      console.log('Allocated Funds:')
      allocations.forEach((alloc: any) => {
        console.log(`- Fund Name: ${alloc.fund_name || alloc.schemeName}`)
        console.log(`  ISIN: ${alloc.isin}`)
        console.log(`  Scheme Code: ${alloc.scheme_code || alloc.schemeCode}`)
        console.log(`  Allocation: ${alloc.allocation_pct || alloc.allocationPct}%`)
        console.log(`  Rationale: ${alloc.rationale}`)
      })
    } else {
      console.log('No direct fund allocations array in result data.')
    }
    
    const riskAndHedge = data.risk_and_hedge_map || data.hedge_instruments
    if (riskAndHedge) {
      console.log('\nHedge & Risk details:')
      console.log(JSON.stringify(riskAndHedge, null, 2))
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
