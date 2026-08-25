import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'

// Type-only helper: infer the schema-aware Drizzle client type without
// constructing a real pool at module load. It is never invoked at runtime.
const __typedDbClient = () => {
  const pool = new Pool()
  return drizzle(pool, { schema })
}

export type DbClient = ReturnType<typeof __typedDbClient>

type DbBundle = { db: DbClient; pool: Pool }

let dbInstance: DbClient | null = null
let poolInstance: Pool | null = null

function getDatabaseUrl(): string {
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example → .env.local and configure it.',
    )
  }
  return DATABASE_URL ?? ''
}

function initDb(): DbBundle {
  if (dbInstance && poolInstance) {
    return { db: dbInstance, pool: poolInstance }
  }

  const DATABASE_URL = getDatabaseUrl()
  poolInstance = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : new Pool()
  dbInstance = drizzle(poolInstance, { schema })

  return { db: dbInstance, pool: poolInstance }
}

/**
 * Lazy database client. Accessing any property initializes the underlying
 * PostgreSQL pool on first use. This keeps `next build` from failing when
 * `DATABASE_URL` is unavailable during static page-data collection.
 *
 * The proxy also supports property descriptors and overrides so that test
 * utilities such as `vi.spyOn(db, 'update')` continue to work.
 */
const dbTarget: Record<string, unknown> = {}
export const db = new Proxy(dbTarget as DbClient, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) {
      return target[prop]
    }
    return (initDb().db as any)[prop]
  },
  set(target, prop, value) {
    if (typeof prop === 'string') {
      target[prop] = value
      return true
    }
    return false
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === 'string' && prop in target) {
      return Object.getOwnPropertyDescriptor(target, prop)
    }
    const value = (initDb().db as any)[prop]
    if (value === undefined) return undefined
    return {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    }
  },
  defineProperty(target, prop, descriptor) {
    if (typeof prop === 'string') {
      Object.defineProperty(target, prop, descriptor)
      return true
    }
    return false
  },
  ownKeys() {
    return Reflect.ownKeys(initDb().db as object)
  },
  has(target, prop) {
    if (typeof prop === 'string' && prop in target) return true
    return prop in (initDb().db as object)
  },
})

/**
 * Lazy database pool. Accessing any property initializes it on first use.
 */
const poolTarget: Record<string, unknown> = {}
export const pool = new Proxy(poolTarget as unknown as Pool, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) {
      return target[prop]
    }
    return (initDb().pool as any)[prop]
  },
  set(target, prop, value) {
    if (typeof prop === 'string') {
      target[prop] = value
      return true
    }
    return false
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === 'string' && prop in target) {
      return Object.getOwnPropertyDescriptor(target, prop)
    }
    const value = (initDb().pool as any)[prop]
    if (value === undefined) return undefined
    return {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    }
  },
  defineProperty(target, prop, descriptor) {
    if (typeof prop === 'string') {
      Object.defineProperty(target, prop, descriptor)
      return true
    }
    return false
  },
  ownKeys() {
    return Reflect.ownKeys(initDb().pool as object)
  },
  has(target, prop) {
    if (typeof prop === 'string' && prop in target) return true
    return prop in (initDb().pool as object)
  },
})

// ── Row Level Security helpers ────────────────────────────────────────────────

/**
 * Run a callback inside a database transaction that impersonates the
 * `authenticated` role used by Supabase Auth. This makes RLS policies that
 * reference `auth.uid()` evaluate against the supplied userId.
 *
 * Use this in tests to verify RLS policies, and in production code paths that
 * need defense-in-depth database-level authorization.
 */
export async function withAuthContext<T>(userId: string, callback: (db: DbClient) => Promise<T>): Promise<T> {
  const { db } = initDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`)
    // SET LOCAL does not accept prepared-statement parameters, so we inline the
    // validated UUID. The value is sourced from Supabase Auth or trusted tests.
    await tx.execute(sql.raw(`SET LOCAL request.jwt.claims.sub = '${userId.replace(/'/g, "''")}'`))
    return callback(tx as unknown as DbClient)
  })
}
