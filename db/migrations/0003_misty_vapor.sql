CREATE TABLE "deliberation_messages" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"pipeline_run_id" uuid,
	"sender" text NOT NULL,
	"recipient" text NOT NULL,
	"message_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"oracle_validation" jsonb NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "deliberation_messages" ADD CONSTRAINT "deliberation_messages_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliberation_messages_run_id_idx" ON "deliberation_messages" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "deliberation_messages_timestamp_idx" ON "deliberation_messages" USING btree ("pipeline_run_id","timestamp");