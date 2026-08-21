import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('--- NON-NULL METRICS COUNT ---')
  const count = await db.execute(sql`
    SELECT COUNT(*) FROM fund_snapshots WHERE aum_cr IS NOT NULL
  `)
  console.log('Number of snapshots with non-null AUM:', count.rows[0]?.count)

  const countComps = await db.execute(sql`
    SELECT COUNT(*) FROM fund_compositions WHERE holdings IS NOT NULL
  `)
  console.log('Number of compositions with non-null holdings:', countComps.rows[0]?.count)

  if (parseInt(count.rows[0]?.count || '0', 10) > 0) {
    console.log('\n--- SAMPLE NON-NULL SNAPSHOTS ---')
    const samples = await db.execute(sql`
      SELECT af.scheme_name, fs.* 
      FROM fund_snapshots fs
      JOIN agent_funds af ON fs.scheme_code = af.scheme_code
      WHERE fs.aum_cr IS NOT NULL 
      LIMIT 10
    `)
    console.log(samples.rows)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
