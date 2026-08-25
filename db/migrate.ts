import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool)

  // Must run before 0000_initial.sql — schema uses vector column type
  console.log('Enabling pgvector extension...')
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)

  // Run all pending migrations in alphabetical order (0000_initial.sql → 0001_pgvector.sql)
  console.log('Running Drizzle migrations...')
  await migrate(db, { migrationsFolder: './db/migrations' })

  // HNSW index requires pgvector and can't be expressed via Drizzle's index builder WITH params.
  // Some local pgvector builds cap HNSW dimensions at 2000; 3072-dim embeddings require a build
  // with higher limits (production Supabase supports this). We warn and continue locally.
  async function createHnswIndex(name: string, table: string, column: string) {
    console.log(`Creating HNSW index on ${table}.${column}...`)
    try {
      await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS ${name}
        ON ${table}
        USING hnsw (${column} vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `))
    } catch (err: any) {
      const messages = [
        err?.message,
        err?.cause?.message,
        err?.cause?.cause?.message,
      ].filter(Boolean) as string[]
      if (messages.some((m) => m.includes('column cannot have more than 2000 dimensions for hnsw index'))) {
        console.warn(
          `Skipping ${name}: local pgvector build does not support HNSW indexes for 3072-dimensional vectors.`,
        )
      } else {
        throw err
      }
    }
  }

  await createHnswIndex(
    'factsheet_chunks_embedding_hnsw_idx',
    'factsheet_chunks',
    'embedding',
  )
  await createHnswIndex(
    'stock_documents_embedding_hnsw_idx',
    'stock_documents',
    'embedding',
  )

  console.log('All migrations complete.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
