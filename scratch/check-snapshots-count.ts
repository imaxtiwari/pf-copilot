import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('--- TABLE ROW COUNTS ---')
  const agentFundsCount = await db.execute(sql`SELECT COUNT(*) FROM agent_funds`)
  const snapshotsCount = await db.execute(sql`SELECT COUNT(*) FROM fund_snapshots`)
  const compositionsCount = await db.execute(sql`SELECT COUNT(*) FROM fund_compositions`)
  
  console.log('agent_funds row count:', agentFundsCount.rows[0]?.count)
  console.log('fund_snapshots row count:', snapshotsCount.rows[0]?.count)
  console.log('fund_compositions row count:', compositionsCount.rows[0]?.count)

  if (parseInt(snapshotsCount.rows[0]?.count || '0', 10) > 0) {
    console.log('\n--- SAMPLE SNAPSHOTS ---')
    const samples = await db.execute(sql`SELECT * FROM fund_snapshots LIMIT 3`)
    console.log(samples.rows)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
