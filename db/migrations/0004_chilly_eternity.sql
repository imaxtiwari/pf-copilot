CREATE TABLE "pipeline_results" (
	"result_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"result_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "pipeline_results_pipeline_run_id_unique" UNIQUE("pipeline_run_id")
);
--> statement-breakpoint
ALTER TABLE "pipeline_results" ADD CONSTRAINT "pipeline_results_pipeline_run_id_pipeline_runs_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("run_id") ON DELETE no action ON UPDATE no action;