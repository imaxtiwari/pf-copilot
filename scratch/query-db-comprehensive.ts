import { db } from '../lib/db'
import * as schema from '../db/schema'
import { desc } from 'drizzle-orm'

async function main() {
  console.log('--- PIPELINE RUNS ---')
  const runs = await db.select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.startedAt))
  console.log(`Found ${runs.length} runs.`)
  for (const r of runs) {
    console.log(`RunId: ${r.runId}, Status: ${r.status}, Cycle: ${r.revisionCycle}, Started: ${r.startedAt}`)
  }

  console.log('\n--- PORTFOLIO DRAFTS ---')
  const drafts = await db.select().from(schema.portfolioDrafts).orderBy(desc(schema.portfolioDrafts.createdAt))
  console.log(`Found ${drafts.length} drafts.`)
  for (const d of drafts) {
    console.log(`DraftId: ${d.draftId}, RunId: ${d.pipelineRunId}, Version: ${d.version}, Status: ${d.status}`)
    console.log(`Goal Buckets:`, JSON.stringify(d.goalBuckets))
    console.log(`Fund Allocations:`, JSON.stringify(d.fundAllocations))
    console.log(`Hedge Instruments:`, JSON.stringify(d.hedgeInstruments))
    console.log('---')
  }

  console.log('\n--- PIPELINE RESULTS ---')
  const results = await db.select().from(schema.pipelineResults).orderBy(desc(schema.pipelineResults.createdAt))
  console.log(`Found ${results.length} results.`)
  for (const r of results) {
    console.log(`ResultId: ${r.resultId}, RunId: ${r.pipelineRunId}, Type: ${r.resultType}`)
    console.log(`Data:`, JSON.stringify(r.data, null, 2))
    console.log('---')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
