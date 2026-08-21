CREATE TABLE "agent_funds" (
	"fund_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text NOT NULL,
	"isin" text,
	"scheme_name" text NOT NULL,
	"amc_name" text NOT NULL,
	"scheme_type" text NOT NULL,
	"benchmark_index" text,
	"sebi_category" text,
	"is_active" boolean DEFAULT true,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_funds_scheme_code_unique" UNIQUE("scheme_code")
);
--> statement-breakpoint
CREATE TABLE "committee_votes" (
	"vote_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_run_id" uuid,
	"draft_id" uuid,
	"voter" text,
	"vote" text,
	"reasoning" text,
	"critical_faults_count" integer DEFAULT 0,
	"hedge_coverage_pct" numeric,
	"voted_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fund_compositions" (
	"composition_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text,
	"composition_date" date,
	"holdings" jsonb,
	"top_10_concentration_pct" numeric,
	"sector_distribution" jsonb,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fund_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text,
	"event_date" date NOT NULL,
	"event_type" text,
	"event_description" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fund_snapshots" (
	"snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text,
	"snapshot_date" date NOT NULL,
	"nav" numeric NOT NULL,
	"nav_52w_high" numeric,
	"nav_52w_low" numeric,
	"aum_cr" numeric,
	"expense_ratio" numeric,
	"return_1y" numeric,
	"return_3y" numeric,
	"return_5y" numeric,
	"return_10y" numeric,
	"alpha_3y" numeric,
	"sharpe_3y" numeric,
	"sortino_3y" numeric,
	"max_drawdown" numeric,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"status" text,
	"revision_cycle" integer DEFAULT 0,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"final_portfolio_id" uuid
);
--> statement-breakpoint
CREATE TABLE "portfolio_drafts" (
	"draft_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_run_id" uuid,
	"client_id" uuid,
	"version" integer NOT NULL,
	"goal_buckets" jsonb NOT NULL,
	"fund_allocations" jsonb NOT NULL,
	"hedge_instruments" jsonb,
	"confidence_score" numeric NOT NULL,
	"backtest_summary" jsonb,
	"open_critique_items" jsonb,
	"status" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "committee_votes" ADD CONSTRAINT "committee_votes_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_votes" ADD CONSTRAINT "committee_votes_draft_id_portfolio_drafts_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."portfolio_drafts"("draft_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_compositions" ADD CONSTRAINT "fund_compositions_scheme_code_agent_funds_scheme_code_fk" FOREIGN KEY ("scheme_code") REFERENCES "public"."agent_funds"("scheme_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_events" ADD CONSTRAINT "fund_events_scheme_code_agent_funds_scheme_code_fk" FOREIGN KEY ("scheme_code") REFERENCES "public"."agent_funds"("scheme_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_snapshots" ADD CONSTRAINT "fund_snapshots_scheme_code_agent_funds_scheme_code_fk" FOREIGN KEY ("scheme_code") REFERENCES "public"."agent_funds"("scheme_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_drafts" ADD CONSTRAINT "portfolio_drafts_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_drafts" ADD CONSTRAINT "portfolio_drafts_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fund_snapshots_unique_idx" ON "fund_snapshots" USING btree ("scheme_code","snapshot_date");