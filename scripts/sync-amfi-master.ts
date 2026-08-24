import { config } from 'dotenv'
config({ path: '.env.local' })

// Pool/db created inside main() — lib/db.ts creates pool at import time, which
// runs before config() due to TypeScript import hoisting, so we init inline here.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { syncAmfiMaster } from '../lib/ingestion/amfi'
import logger from '../lib/logger'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    const result = await syncAmfiMaster(db)
    logger.info(result, 'sync-amfi: complete')
  } catch (e) {
    logger.error({ err: String(e) }, 'sync-amfi: fatal error')
    await pool.end()
    process.exit(1)
  }

  await pool.end()
}

main().catch((e) => {
  logger.error({ err: String(e) }, 'sync-amfi: fatal error')
  process.exit(1)
})
