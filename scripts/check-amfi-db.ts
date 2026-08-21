import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    const count = await db.$count(schema.amfiSchemeMaster)
    console.log(`Connection successful. amfi_scheme_master has ${count} records.`)

    if (count > 0) {
      console.log('Sample records:')
      const samples = await db.select().from(schema.amfiSchemeMaster).limit(5)
      console.log(JSON.stringify(samples, null, 2))
    }
  } catch (err) {
    console.error('Database query failed:', err)
  } finally {
    await pool.end()
  }
}

main()
