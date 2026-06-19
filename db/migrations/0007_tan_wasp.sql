CREATE TABLE "behavioral_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"fingerprint" jsonb NOT NULL,
	"patterns_detected" integer NOT NULL,
	"abandonment_risk" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "behavioral_fingerprints_pipeline_run_id_unique" UNIQUE("pipeline_run_id")
);
--> statement-breakpoint
CREATE TABLE "comparison_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_reports_pipeline_run_id_unique" UNIQUE("pipeline_run_id")
);
--> statement-breakpoint
CREATE TABLE "drift_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_cas_upload_id" uuid,
	"current_cas_upload_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD COLUMN "reply_to_message_id" uuid;--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD COLUMN "thread_root_id" uuid;--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD COLUMN "depth" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "portfolio_drafts" ADD COLUMN "aria_fault_count" jsonb;--> statement-breakpoint
ALTER TABLE "behavioral_fingerprints" ADD CONSTRAINT "behavioral_fingerprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_fingerprints" ADD CONSTRAINT "behavioral_fingerprints_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_reports" ADD CONSTRAINT "comparison_reports_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_reports" ADD CONSTRAINT "comparison_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_reports" ADD CONSTRAINT "drift_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_reports" ADD CONSTRAINT "drift_reports_previous_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("previous_cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_reports" ADD CONSTRAINT "drift_reports_current_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("current_cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD CONSTRAINT "deliberation_messages_reply_to_message_id_deliberation_messages_message_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."deliberation_messages"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD CONSTRAINT "deliberation_messages_thread_root_id_deliberation_messages_message_id_fk" FOREIGN KEY ("thread_root_id") REFERENCES "public"."deliberation_messages"("message_id") ON DELETE no action ON UPDATE no action;