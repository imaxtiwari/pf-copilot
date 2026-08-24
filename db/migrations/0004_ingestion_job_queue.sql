-- Ingestion job queue tracking for long-running data syncs.

CREATE TYPE "ingestion_job_type" AS ENUM ('ingest.amfi', 'ingest.factsheets', 'ingest.annualReports');
CREATE TYPE "ingestion_status" AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "ingestion_job_type" NOT NULL,
	"payload_hash" text NOT NULL,
	"status" "ingestion_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ingestion_runs_job_type_idx" ON "ingestion_runs" ("job_type");
CREATE INDEX IF NOT EXISTS "ingestion_runs_status_idx" ON "ingestion_runs" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_runs_unique_idx" ON "ingestion_runs" ("job_type", "payload_hash");
