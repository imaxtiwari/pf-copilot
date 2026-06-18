import { db } from '../lib/db'
import * as schema from '../db/schema'

async function main() {
  console.log('Fetching all database records for portfolio drafts...')
  const drafts = await db.select().from(schema.portfolioDrafts)
  console.log(`Found ${drafts.length} drafts total.`)

  for (const d of drafts) {
    console.log(`\nDraft ID: ${d.draftId} (Run: ${d.pipelineRunId}, Version: ${d.version}, Status: ${d.status})`)
    console.log('Goal Buckets:', JSON.stringify(d.goalBuckets))
    console.log('Fund Allocations:')
    const allocations = d.fundAllocations as any[]
    if (allocations && Array.isArray(allocations)) {
      allocations.forEach(a => {
        console.log(` - Fund Name: ${a.fund_name || a.fundName || a.schemeName}`)
        console.log(`   Allocation: ${a.allocation_pct || a.allocationPct}%`)
        console.log(`   ISIN: ${a.isin}`)
        console.log(`   Rationale: ${a.rationale}`)
      })
    }
  }

  console.log('\nFetching all database records for pipeline results...')
  const results = await db.select().from(schema.pipelineResults)
  console.log(`Found ${results.length} results total.`)
  for (const r of results) {
    console.log(`\nResult ID: ${r.resultId} (Run: ${r.pipelineRunId}, Type: ${r.resultType})`)
    const data = r.data as any
    const allocations = data.portfolio_recommendation?.fund_allocations || data.fund_allocations || data.compromise_allocation
    if (allocations) {
      console.log('Allocations in result:')
      console.log(JSON.stringify(allocations, null, 2))
    } else {
      console.log('No direct allocations array in result data.')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
