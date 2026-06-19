import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set in .env.local')

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool)

  // Must run before 0000_initial.sql — schema uses vector column type
  console.log('Enabling pgvector extension...')
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)

  // Run all pending migrations in alphabetical order (0000_initial.sql → 0001_pgvector.sql)
  console.log('Running Drizzle migrations...')
  await migrate(db, { migrationsFolder: './db/migrations' })

  // HNSW index requires pgvector and can't be expressed via Drizzle's index builder WITH params
  console.log('Creating HNSW index on factsheet_chunks.embedding...')
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS factsheet_chunks_embedding_hnsw_idx
    ON factsheet_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `)

  console.log('Creating HNSW index on knowledge_commons.embedding...')
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS knowledge_commons_embedding_hnsw_idx
    ON knowledge_commons
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `)

  console.log('Creating immutable triggers for fund_snapshots...')
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION prevent_update()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'NO UPDATES EVER: Rows in this table are immutable.';
    END;
    $$ LANGUAGE plpgsql;
  `)
  
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'fund_snapshots_prevent_update'
      ) THEN
        CREATE TRIGGER fund_snapshots_prevent_update
        BEFORE UPDATE ON fund_snapshots
        FOR EACH ROW EXECUTE FUNCTION prevent_update();
      END IF;
    END
    $$;
  `)

  console.log('Migrating existing deliberation messages to become roots...')
  await db.execute(sql`
    UPDATE deliberation_messages
    SET thread_root_id = message_id, depth = 0
    WHERE reply_to_message_id IS NULL
  `)

  console.log('All migrations complete.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
