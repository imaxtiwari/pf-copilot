import { db } from '../lib/db'
import * as schema from '../db/schema'
import { desc, eq } from 'drizzle-orm'

async function main() {
  console.log('🔍 Listing all runs in the database...')
  const runs = await db.select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.startedAt))
  
  for (const run of runs) {
    console.log(`\n==================================================`)
    console.log(`Run ID: ${run.runId} | Status: ${run.status}`)
    console.log(`==================================================`)
    
    // Check if there are deliberation messages
    const msgs = await db
      .select()
      .from(schema.deliberationMessages)
      .where(eq(schema.deliberationMessages.pipelineRunId, run.runId))
      .orderBy(schema.deliberationMessages.timestamp)
    
    console.log(`Deliberation Messages Count: ${msgs.length}`)
    
    // Check if we have portfolio drafts
    const drafts = await db
      .select()
      .from(schema.portfolioDrafts)
      .where(eq(schema.portfolioDrafts.pipelineRunId, run.runId))
    
    console.log(`Drafts Count: ${drafts.length}`)
    for (const d of drafts) {
      console.log(`  Draft version ${d.version} confidence: ${d.confidenceScore}`)
      const allocs = d.fundAllocations as any[]
      if (allocs && Array.isArray(allocs)) {
        allocs.forEach(a => {
          console.log(`    - ${a.fund_name || a.fundName || a.schemeName}: ${a.allocation_pct || a.allocationPct}% | Rationale: ${a.rationale}`)
        })
      }
    }

    // Check if we have pipeline results
    const results = await db
      .select()
      .from(schema.pipelineResults)
      .where(eq(schema.pipelineResults.pipelineRunId, run.runId))
    console.log(`Results Count: ${results.length}`)
    for (const r of results) {
      console.log(`  Result Type: ${r.resultType}`)
      console.log(`  Data:`, JSON.stringify(r.data, null, 2))
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
