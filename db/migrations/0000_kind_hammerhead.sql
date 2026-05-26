CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."city_tier" AS ENUM('metro', 'tier2', 'tier3');--> statement-breakpoint
CREATE TYPE "public"."dependents" AS ENUM('none', 'spouse', 'kids', 'parents', 'multiple');--> statement-breakpoint
CREATE TYPE "public"."holding_source" AS ENUM('cas_text', 'cas_vision', 'manual');--> statement-breakpoint
CREATE TABLE "amfi_scheme_master" (
	"scheme_code" text PRIMARY KEY NOT NULL,
	"scheme_name" text NOT NULL,
	"amc_name" text NOT NULL,
	"scheme_type" text NOT NULL,
	"last_synced" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cas_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_hash" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"validation_errors" jsonb,
	"total_value_reported" numeric,
	"total_value_computed" numeric,
	"vision_used" boolean DEFAULT false NOT NULL,
	"raw_text_preview" text
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"tool_name" text
);
--> statement-breakpoint
CREATE TABLE "factsheet_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text NOT NULL,
	"scheme_name" text NOT NULL,
	"section" text NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536),
	"source_url" text NOT NULL,
	"factsheet_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scheme_code" text,
	"scheme_name" text NOT NULL,
	"folio_number" text NOT NULL,
	"units" numeric NOT NULL,
	"nav" numeric NOT NULL,
	"market_value" numeric NOT NULL,
	"as_of_date" date NOT NULL,
	"source" "holding_source" NOT NULL,
	"cas_upload_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"age" integer,
	"city_tier" "city_tier",
	"monthly_rent" numeric,
	"owns_home" boolean,
	"dependents" "dependents",
	"medical_conditions" boolean,
	"inflation_rate" numeric,
	"inflation_breakdown" jsonb,
	"inflation_confidence" text,
	"computed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cas_uploads" ADD CONSTRAINT "cas_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cas_uploads_file_hash_idx" ON "cas_uploads" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "chat_messages_user_ts_idx" ON "chat_messages" USING btree ("user_id","ts" DESC);--> statement-breakpoint
CREATE INDEX "factsheet_chunks_scheme_code_idx" ON "factsheet_chunks" USING btree ("scheme_code");--> statement-breakpoint
CREATE UNIQUE INDEX "factsheet_chunks_unique_idx" ON "factsheet_chunks" USING btree ("scheme_code","section","factsheet_date","chunk_text");