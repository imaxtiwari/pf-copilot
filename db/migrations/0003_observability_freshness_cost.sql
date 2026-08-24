-- Observability additions: cost tracking on users, freshness flags on data tables.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_cost" numeric DEFAULT '0' NOT NULL;

ALTER TABLE "factsheet_chunks" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
ALTER TABLE "factsheet_chunks" ADD COLUMN IF NOT EXISTS "freshness_days" integer DEFAULT 7;
ALTER TABLE "factsheet_chunks" ADD COLUMN IF NOT EXISTS "is_stale" boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS "factsheet_chunks_stale_idx" ON "factsheet_chunks" ("is_stale");

ALTER TABLE "stock_documents" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
ALTER TABLE "stock_documents" ADD COLUMN IF NOT EXISTS "freshness_days" integer DEFAULT 7;
ALTER TABLE "stock_documents" ADD COLUMN IF NOT EXISTS "is_stale" boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS "stock_documents_stale_idx" ON "stock_documents" ("is_stale");

ALTER TABLE "portfolio_snapshots" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
ALTER TABLE "portfolio_snapshots" ADD COLUMN IF NOT EXISTS "freshness_days" integer DEFAULT 1;
ALTER TABLE "portfolio_snapshots" ADD COLUMN IF NOT EXISTS "is_stale" boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_stale_idx" ON "portfolio_snapshots" ("is_stale");
