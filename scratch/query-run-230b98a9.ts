import { db } from '../lib/db'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  const runId = '230b98a9-4dd2-4f32-8fb7-65e614c0ff3a'
  console.log(`🔍 Querying database for Run ID: ${runId}`)

  const [run] = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId)).limit(1)
  if (!run) {
    console.log('Run not found!')
    return
  }

  console.log(`Status: ${run.status}, Revision Cycle: ${run.revisionCycle}`)

  const drafts = await db.select().from(schema.portfolioDrafts).where(eq(schema.portfolioDrafts.pipelineRunId, runId))
  console.log(`Found ${drafts.length} drafts:`)

  for (const d of drafts) {
    console.log(`\nDraft ID: ${d.draftId} | Version: ${d.version} | Confidence Score: ${d.confidenceScore}`)
    console.log('Goal Buckets:', JSON.stringify(d.goalBuckets))
    console.log('Fund Allocations:')
    const allocs = d.fundAllocations as any[]
    if (allocs && Array.isArray(allocs)) {
      allocs.forEach(a => {
        console.log(` - ${a.fund_name || a.fundName || a.schemeName} (${a.allocation_pct || a.allocationPct}%)`)
        console.log(`   ISIN: ${a.isin} | Scheme Code: ${a.scheme_code || a.schemeCode}`)
        console.log(`   Rationale: ${a.rationale}`)
      })
    }
  }

  const results = await db.select().from(schema.pipelineResults).where(eq(schema.pipelineResults.pipelineRunId, runId))
  console.log(`\nFound ${results.length} results:`)
  for (const r of results) {
    console.log(`Result ID: ${r.resultId} | Type: ${r.resultType}`)
    console.log(`Data:`, JSON.stringify(r.data, null, 2))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
