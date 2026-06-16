import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { config } from 'dotenv'
import { eq, like, desc, sql } from 'drizzle-orm'
config({ path: '.env.local' })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    // 1. Check total snapshots
    const snapshotCount = await db.$count(schema.fundSnapshots)
    console.log(`Total snapshots: ${snapshotCount}`)

    // 2. Check types of funds
    const fundTypes = await db.select({
      schemeType: schema.agentFunds.schemeType,
      count: sql<number>`count(*)`
    }).from(schema.agentFunds)
    .groupBy(schema.agentFunds.schemeType)
    console.log('Fund Types count:', fundTypes)

    // 3. Find Nifty 50 related funds in agentFunds
    const niftyFunds = await db.select({
      schemeCode: schema.agentFunds.schemeCode,
      schemeName: schema.agentFunds.schemeName,
      schemeType: schema.agentFunds.schemeType
    })
    .from(schema.agentFunds)
    .where(like(schema.agentFunds.schemeName, '%Nifty 50%'))
    .limit(10)
    console.log('Sample Nifty 50 Funds:', niftyFunds)

    // 4. Check date range of snapshots
    const dateRange = await db.select({
      minDate: sql<string>`min(snapshot_date)`,
      maxDate: sql<string>`max(snapshot_date)`
    }).from(schema.fundSnapshots)
    console.log('Snapshot Date Range:', dateRange)

    // 5. Look for Nifty 50 TRI or standard index benchmarks
    const indexFunds = await db.select({
      schemeCode: schema.agentFunds.schemeCode,
      schemeName: schema.agentFunds.schemeName
    }).from(schema.agentFunds)
    .where(eq(schema.agentFunds.schemeType, 'index'))
    .limit(5)
    console.log('Sample Index Funds:', indexFunds)

  } catch (err) {
    console.error('Database query failed:', err)
  } finally {
    await pool.end()
  }
}

main()
