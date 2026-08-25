-- Migration: restore DHRUV educational simulation pipeline tables
-- Includes RLS policies and immutable audit-log triggers.

-- ── Pipeline runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "stage" text DEFAULT 'INTAKE' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "revision_cycle" integer DEFAULT 0 NOT NULL,
  "final_portfolio_id" uuid,
  "best_draft_id" uuid,
  "impossibility_reason" text,
  "completed_at" timestamp,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pipeline_runs_client_id_idx" ON "pipeline_runs" ("client_id");
CREATE INDEX IF NOT EXISTS "pipeline_runs_status_idx" ON "pipeline_runs" ("status");
CREATE INDEX IF NOT EXISTS "pipeline_runs_started_at_idx" ON "pipeline_runs" ("started_at");

-- ── Pipeline results ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pipeline_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "result_type" text NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pipeline_results_run_id_idx" ON "pipeline_results" ("pipeline_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_results_run_type_idx" ON "pipeline_results" ("pipeline_run_id", "result_type");

-- ── Portfolio drafts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "portfolio_drafts" (
  "draft_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "portfolio_id" uuid,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "version" integer DEFAULT 1 NOT NULL,
  "revision_number" integer DEFAULT 0 NOT NULL,
  "client_id" uuid REFERENCES "public"."users"("id") ON DELETE cascade,
  "goal_buckets" jsonb DEFAULT '[]'::jsonb,
  "fund_allocations" jsonb DEFAULT '[]'::jsonb,
  "model_allocation" jsonb DEFAULT '[]'::jsonb,
  "strategy_framework" text,
  "confidence_score" numeric,
  "risk_flags" jsonb DEFAULT '[]'::jsonb,
  "rationale" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "portfolio_drafts_run_id_idx" ON "portfolio_drafts" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "portfolio_drafts_created_at_idx" ON "portfolio_drafts" ("created_at");

-- ── Deliberation messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "deliberation_messages" (
  "message_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "reply_to_message_id" uuid,
  "thread_root_id" uuid,
  "sender" text NOT NULL,
  "message_type" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "timestamp" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "deliberation_messages_run_id_idx" ON "deliberation_messages" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "deliberation_messages_created_at_idx" ON "deliberation_messages" ("created_at");
CREATE INDEX IF NOT EXISTS "deliberation_messages_sender_idx" ON "deliberation_messages" ("sender");

-- ── Committee votes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "committee_votes" (
  "vote_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "agent_id" text NOT NULL,
  "vote" text NOT NULL,
  "rationale" text,
  "voted_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "committee_votes_run_id_idx" ON "committee_votes" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "committee_votes_voted_at_idx" ON "committee_votes" ("voted_at");

-- ── Comparison reports ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "comparison_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "comparison_reports_run_id_idx" ON "comparison_reports" ("pipeline_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "comparison_reports_run_id_unique_idx" ON "comparison_reports" ("pipeline_run_id");

-- ── Compliance reports ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "compliance_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "compliance_reports_run_id_idx" ON "compliance_reports" ("pipeline_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_reports_run_id_unique_idx" ON "compliance_reports" ("pipeline_run_id");

-- ── Behavioral fingerprints ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "behavioral_fingerprints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade,
  "user_id" uuid REFERENCES "public"."users"("id") ON DELETE cascade,
  "fingerprint" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "behavioral_fingerprints_run_id_idx" ON "behavioral_fingerprints" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "behavioral_fingerprints_user_id_idx" ON "behavioral_fingerprints" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "behavioral_fingerprints_run_id_unique_idx" ON "behavioral_fingerprints" ("pipeline_run_id");

-- ── Audit trail (PostgreSQL replacement for SQLite audit-trail.ts) ────────────
CREATE TABLE IF NOT EXISTS "pipeline_audit_logs" (
  "log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE no action,
  "timestamp" timestamp DEFAULT now() NOT NULL,
  "agent_id" text NOT NULL,
  "action_type" text NOT NULL,
  "oracle_confidence" real,
  "payload_hash" text NOT NULL,
  "payload_json" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pipeline_audit_logs_run_id_idx" ON "pipeline_audit_logs" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "pipeline_audit_logs_user_id_idx" ON "pipeline_audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "pipeline_audit_logs_timestamp_idx" ON "pipeline_audit_logs" ("timestamp");
CREATE INDEX IF NOT EXISTS "pipeline_audit_logs_action_type_idx" ON "pipeline_audit_logs" ("action_type");

-- ── Fund data tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_funds" (
  "scheme_code" text PRIMARY KEY NOT NULL,
  "scheme_name" text NOT NULL,
  "amc_name" text,
  "scheme_type" text NOT NULL,
  "amfi_category" text,
  "sebi_category" text,
  "expense_ratio" numeric,
  "aum" numeric,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_synced" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "agent_funds_scheme_type_idx" ON "agent_funds" ("scheme_type");
CREATE INDEX IF NOT EXISTS "agent_funds_active_idx" ON "agent_funds" ("is_active");

CREATE TABLE IF NOT EXISTS "fund_snapshots" (
  "snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scheme_code" text NOT NULL REFERENCES "public"."agent_funds"("scheme_code") ON DELETE cascade,
  "snapshot_date" date NOT NULL,
  "nav" numeric NOT NULL,
  "open" numeric,
  "high" numeric,
  "low" numeric,
  "close" numeric,
  "volume" numeric,
  "adjusted_close" numeric,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "fund_snapshots_scheme_date_idx" ON "fund_snapshots" ("scheme_code", "snapshot_date");
CREATE UNIQUE INDEX IF NOT EXISTS "fund_snapshots_scheme_date_unique_idx" ON "fund_snapshots" ("scheme_code", "snapshot_date");

CREATE TABLE IF NOT EXISTS "fund_compositions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scheme_code" text NOT NULL REFERENCES "public"."agent_funds"("scheme_code") ON DELETE cascade,
  "holding_name" text,
  "instrument_type" text,
  "sector" text,
  "weight" numeric,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "fund_compositions_scheme_code_idx" ON "fund_compositions" ("scheme_code");
CREATE INDEX IF NOT EXISTS "fund_compositions_created_at_idx" ON "fund_compositions" ("created_at");

-- ── Drift & SIP reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "drift_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "pipeline_run_id" uuid REFERENCES "public"."pipeline_runs"("run_id") ON DELETE set null,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drift_reports_user_id_idx" ON "drift_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "drift_reports_generated_at_idx" ON "drift_reports" ("generated_at");

CREATE TABLE IF NOT EXISTS "sip_adherence_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "pipeline_run_id" uuid REFERENCES "public"."pipeline_runs"("run_id") ON DELETE set null,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sip_adherence_reports_user_id_idx" ON "sip_adherence_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "sip_adherence_reports_generated_at_idx" ON "sip_adherence_reports" ("generated_at");

-- ── Scheduler tables (global, no user_id) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scheduler_locks" (
  "job_name" text PRIMARY KEY NOT NULL,
  "locked_at" timestamp DEFAULT now() NOT NULL,
  "locked_by" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "scheduler_locks_locked_at_idx" ON "scheduler_locks" ("locked_at");

CREATE TABLE IF NOT EXISTS "scheduler_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_name" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  "metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "scheduler_runs_job_name_idx" ON "scheduler_runs" ("job_name");
CREATE INDEX IF NOT EXISTS "scheduler_runs_started_at_idx" ON "scheduler_runs" ("started_at");

-- ── Knowledge commons ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_commons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" text NOT NULL,
  "memory_type" text NOT NULL,
  "summary" text NOT NULL,
  "embedding" vector(1536),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_url" text NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "knowledge_commons_agent_id_idx" ON "knowledge_commons" ("agent_id");
CREATE INDEX IF NOT EXISTS "knowledge_commons_memory_type_idx" ON "knowledge_commons" ("memory_type");

-- ── Row Level Security ────────────────────────────────────────────────────────
-- All user-scoped tables are protected by RLS. Service-role operations bypass RLS
-- by using the postgres/service role directly; application code must enforce auth.

-- pipeline_runs: users can only see/own their own runs.
ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_runs_user_all" ON "pipeline_runs";
CREATE POLICY "pipeline_runs_user_all" ON "pipeline_runs"
  FOR ALL TO authenticated
  USING ("client_id" = auth.uid())
  WITH CHECK ("client_id" = auth.uid());

-- pipeline_results: owned through pipeline_runs.
ALTER TABLE "pipeline_results" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_results_user_select" ON "pipeline_results";
CREATE POLICY "pipeline_results_user_select" ON "pipeline_results"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "pipeline_results"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- portfolio_drafts: owned through pipeline_runs.
ALTER TABLE "portfolio_drafts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portfolio_drafts_user_select" ON "portfolio_drafts";
CREATE POLICY "portfolio_drafts_user_select" ON "portfolio_drafts"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "portfolio_drafts"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- deliberation_messages: owned through pipeline_runs.
ALTER TABLE "deliberation_messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deliberation_messages_user_select" ON "deliberation_messages";
CREATE POLICY "deliberation_messages_user_select" ON "deliberation_messages"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "deliberation_messages"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- committee_votes: owned through pipeline_runs.
ALTER TABLE "committee_votes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "committee_votes_user_select" ON "committee_votes";
CREATE POLICY "committee_votes_user_select" ON "committee_votes"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "committee_votes"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- comparison_reports: owned through pipeline_runs.
ALTER TABLE "comparison_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "comparison_reports_user_select" ON "comparison_reports";
CREATE POLICY "comparison_reports_user_select" ON "comparison_reports"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "comparison_reports"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- compliance_reports: owned through pipeline_runs.
ALTER TABLE "compliance_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "compliance_reports_user_select" ON "compliance_reports";
CREATE POLICY "compliance_reports_user_select" ON "compliance_reports"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "compliance_reports"."pipeline_run_id" AND "client_id" = auth.uid()
  ));

-- behavioral_fingerprints: owned through pipeline_runs (also carries user_id for direct check).
ALTER TABLE "behavioral_fingerprints" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "behavioral_fingerprints_user_select" ON "behavioral_fingerprints";
CREATE POLICY "behavioral_fingerprints_user_select" ON "behavioral_fingerprints"
  FOR SELECT TO authenticated
  USING (
    "user_id" = auth.uid() OR EXISTS (
      SELECT 1 FROM "pipeline_runs" WHERE "run_id" = "behavioral_fingerprints"."pipeline_run_id" AND "client_id" = auth.uid()
    )
  );

-- pipeline_audit_logs: immutable; users can read their own logs.
ALTER TABLE "pipeline_audit_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_audit_logs_user_select" ON "pipeline_audit_logs";
CREATE POLICY "pipeline_audit_logs_user_select" ON "pipeline_audit_logs"
  FOR SELECT TO authenticated
  USING ("user_id" = auth.uid());

-- drift_reports: direct user ownership.
ALTER TABLE "drift_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drift_reports_user_all" ON "drift_reports";
CREATE POLICY "drift_reports_user_all" ON "drift_reports"
  FOR ALL TO authenticated
  USING ("user_id" = auth.uid())
  WITH CHECK ("user_id" = auth.uid());

-- sip_adherence_reports: direct user ownership.
ALTER TABLE "sip_adherence_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sip_adherence_reports_user_all" ON "sip_adherence_reports";
CREATE POLICY "sip_adherence_reports_user_all" ON "sip_adherence_reports"
  FOR ALL TO authenticated
  USING ("user_id" = auth.uid())
  WITH CHECK ("user_id" = auth.uid());

-- Reference/global tables: read-only for authenticated users.
ALTER TABLE "agent_funds" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_funds_user_select" ON "agent_funds";
CREATE POLICY "agent_funds_user_select" ON "agent_funds"
  FOR SELECT TO authenticated USING (true);

ALTER TABLE "fund_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fund_snapshots_user_select" ON "fund_snapshots";
CREATE POLICY "fund_snapshots_user_select" ON "fund_snapshots"
  FOR SELECT TO authenticated USING (true);

ALTER TABLE "fund_compositions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fund_compositions_user_select" ON "fund_compositions";
CREATE POLICY "fund_compositions_user_select" ON "fund_compositions"
  FOR SELECT TO authenticated USING (true);

ALTER TABLE "knowledge_commons" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "knowledge_commons_user_select" ON "knowledge_commons";
CREATE POLICY "knowledge_commons_user_select" ON "knowledge_commons"
  FOR SELECT TO authenticated USING (true);

-- Scheduler tables: global state; authenticated can read, writes restricted to service role.
ALTER TABLE "scheduler_locks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduler_locks_user_select" ON "scheduler_locks";
CREATE POLICY "scheduler_locks_user_select" ON "scheduler_locks"
  FOR SELECT TO authenticated USING (true);

ALTER TABLE "scheduler_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduler_runs_user_select" ON "scheduler_runs";
CREATE POLICY "scheduler_runs_user_select" ON "scheduler_runs"
  FOR SELECT TO authenticated USING (true);

-- ── Audit-log immutability triggers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION raise_immutable_audit_error()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_update_audit_logs ON "pipeline_audit_logs";
CREATE TRIGGER prevent_update_audit_logs
  BEFORE UPDATE ON "pipeline_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable_audit_error();

DROP TRIGGER IF EXISTS prevent_delete_audit_logs ON "pipeline_audit_logs";
CREATE TRIGGER prevent_delete_audit_logs
  BEFORE DELETE ON "pipeline_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable_audit_error();
