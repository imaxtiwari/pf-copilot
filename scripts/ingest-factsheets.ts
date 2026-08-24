import { config } from 'dotenv'
config({ path: '.env.local' })

// Pool/db created inside main() — avoids TypeScript import-hoisting problem
// where lib/db.ts pool would be constructed before dotenv runs.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { ingestFactsheets } from '../lib/ingestion/factsheets'
import logger from '../lib/logger'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    const result = await ingestFactsheets(db)
    logger.info(result, 'ingest: all targets processed')
  } catch (e) {
    logger.error({ err: String(e) }, 'ingest: fatal error')
    await pool.end()
    process.exit(1)
  }

  await pool.end()
}

main().catch((e) => {
  logger.error({ err: String(e) }, 'ingest: fatal error')
  process.exit(1)
})
