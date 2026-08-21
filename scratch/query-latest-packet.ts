import { db } from '../lib/db'
import * as schema from '../db/schema'
import { desc, eq } from 'drizzle-orm'

async function main() {
  const [result] = await db
    .select()
    .from(schema.pipelineResults)
    .where(eq(schema.pipelineResults.resultType, 'packet'))
    .orderBy(desc(schema.pipelineResults.createdAt))
    .limit(1)

  if (result) {
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log('No packet found')
  }

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
