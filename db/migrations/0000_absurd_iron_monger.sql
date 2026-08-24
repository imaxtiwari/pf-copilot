CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."city_tier" AS ENUM('metro', 'tier2', 'tier3');--> statement-breakpoint
CREATE TYPE "public"."dependents" AS ENUM('none', 'spouse', 'kids', 'parents', 'multiple');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('annual_report', 'bse_announcement', 'other');--> statement-breakpoint
CREATE TYPE "public"."holding_source" AS ENUM('cas_text', 'cas_vision', 'manual');--> statement-breakpoint
CREATE TYPE "public"."insight_template" AS ENUM('personal_inflation_vs_cpi', 'highest_lowest_real_return', 'mid_small_cap_concentration', 'unmatched_schemes');--> statement-breakpoint
CREATE TABLE "amfi_scheme_master" (
	"scheme_code" text PRIMARY KEY NOT NULL,
	"scheme_name" text NOT NULL,
	"amc_name" text NOT NULL,
	"scheme_type" text NOT NULL,
	"amfi_category" text,
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
	"tool_name" text,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"model_version" text,
	"refusal_reason" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "demat_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"isin" text NOT NULL,
	"company_name" text NOT NULL,
	"quantity" numeric NOT NULL,
	"price" numeric NOT NULL,
	"value" numeric NOT NULL,
	"as_of_date" date NOT NULL,
	"source" "holding_source" NOT NULL,
	"cas_upload_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factsheet_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_code" text NOT NULL,
	"scheme_name" text NOT NULL,
	"section" text NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(3072),
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
CREATE TABLE "portfolio_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cas_upload_id" uuid,
	"template" "insight_template" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"total_value" numeric NOT NULL,
	"real_return_annualized" numeric,
	"inflation_rate_used" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isin" text NOT NULL,
	"company_name" text NOT NULL,
	"document_date" date NOT NULL,
	"source" "document_source" NOT NULL,
	"section" text NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(3072),
	"source_url" text NOT NULL,
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
ALTER TABLE "demat_holdings" ADD CONSTRAINT "demat_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demat_holdings" ADD CONSTRAINT "demat_holdings_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_insights" ADD CONSTRAINT "portfolio_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_insights" ADD CONSTRAINT "portfolio_insights_cas_upload_id_cas_uploads_id_fk" FOREIGN KEY ("cas_upload_id") REFERENCES "public"."cas_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amfi_scheme_master_amfi_category_idx" ON "amfi_scheme_master" USING btree ("amfi_category");--> statement-breakpoint
CREATE INDEX "amfi_scheme_master_last_synced_idx" ON "amfi_scheme_master" USING btree ("last_synced");--> statement-breakpoint
CREATE INDEX "cas_uploads_user_id_idx" ON "cas_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cas_uploads_file_hash_idx" ON "cas_uploads" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "chat_messages_user_ts_idx" ON "chat_messages" USING btree ("user_id","ts" DESC);--> statement-breakpoint
CREATE INDEX "chat_messages_request_id_idx" ON "chat_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "demat_holdings_user_isin_idx" ON "demat_holdings" USING btree ("user_id","isin");--> statement-breakpoint
CREATE INDEX "demat_holdings_user_date_idx" ON "demat_holdings" USING btree ("user_id","as_of_date");--> statement-breakpoint
CREATE INDEX "factsheet_chunks_scheme_code_idx" ON "factsheet_chunks" USING btree ("scheme_code");--> statement-breakpoint
CREATE UNIQUE INDEX "factsheet_chunks_unique_idx" ON "factsheet_chunks" USING btree ("scheme_code","section","factsheet_date","chunk_text");--> statement-breakpoint
CREATE INDEX "portfolio_holdings_user_id_idx" ON "portfolio_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolio_holdings_user_scheme_idx" ON "portfolio_holdings" USING btree ("user_id","scheme_code");--> statement-breakpoint
CREATE INDEX "portfolio_holdings_user_date_idx" ON "portfolio_holdings" USING btree ("user_id","as_of_date");--> statement-breakpoint
CREATE INDEX "portfolio_insights_user_generated_idx" ON "portfolio_insights" USING btree ("user_id","generated_at");--> statement-breakpoint
CREATE INDEX "portfolio_insights_template_idx" ON "portfolio_insights" USING btree ("template");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_user_date_idx" ON "portfolio_snapshots" USING btree ("user_id","as_of_date");--> statement-breakpoint
CREATE INDEX "stock_documents_isin_idx" ON "stock_documents" USING btree ("isin");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_documents_unique_idx" ON "stock_documents" USING btree ("isin","source","document_date","section","chunk_text");--> statement-breakpoint
CREATE INDEX "user_profile_user_id_idx" ON "user_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");