-- Enable pgvector extension (idempotent; also runs at top of db/migrate.ts before table creation)
CREATE EXTENSION IF NOT EXISTS vector;
