import { db } from '../lib/db'
import * as schema from '../db/schema'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('🔍 Checking fund categories in database...')
  const counts = await db.execute(sql`
    SELECT scheme_type, COUNT(*) as count 
    FROM agent_funds 
    GROUP BY scheme_type
  `)
  console.log(counts.rows)

  console.log('\n🔍 Sample funds from each category:')
  const samples = await db.execute(sql`
    SELECT scheme_code, scheme_name, scheme_type 
    FROM agent_funds 
    LIMIT 20
  `)
  console.log(samples.rows)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
