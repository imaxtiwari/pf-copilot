import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.NODE_ENV !== 'test') {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example → .env.local and configure it.',
  )
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : new Pool()

export const db = drizzle(pool, { schema })
export { pool }
