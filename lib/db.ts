import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example → .env.local and configure it.',
  )
}

const pool = new Pool({ connectionString: DATABASE_URL })

export const db = drizzle(pool, { schema })
export { pool }
