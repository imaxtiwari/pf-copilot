import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '@/db/schema'

const typedDb = () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot' })
  return drizzle(pool, { schema })
}

export type TestDb = ReturnType<typeof typedDb>

export function createTestPool(): Pool {
  const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'
  return new Pool({ connectionString: url })
}

export function createTestDb(pool: Pool): TestDb {
  return drizzle(pool, { schema })
}
