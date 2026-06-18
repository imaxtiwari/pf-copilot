CREATE TABLE "scheduler_locks" (
	"job_name" text PRIMARY KEY NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"locked_by" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text,
	"duration_ms" integer,
	"error_msg" text
);
