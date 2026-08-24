import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
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

// ── Row Level Security helpers ────────────────────────────────────────────────

export type DbClient = typeof db

/**
 * Run a callback inside a database transaction that impersonates the
 * `authenticated` role used by Supabase Auth. This makes RLS policies that
 * reference `auth.uid()` evaluate against the supplied userId.
 *
 * Use this in tests to verify RLS policies, and in production code paths that
 * need defense-in-depth database-level authorization.
 */
export async function withAuthContext<T>(userId: string, callback: (db: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`)
    await tx.execute(sql`SET LOCAL request.jwt.claims.sub = ${userId}`)
    return callback(tx as unknown as DbClient)
  })
}
