CREATE TABLE "knowledge_commons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"summary" text NOT NULL,
	"source_urls" jsonb NOT NULL,
	"tags" jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
