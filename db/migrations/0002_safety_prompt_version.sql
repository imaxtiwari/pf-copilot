-- Migration: add prompt_version and safety_score to chat_messages, and create safety_review_queue

ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "prompt_version" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "safety_score" real DEFAULT 0;

CREATE INDEX IF NOT EXISTS "chat_messages_prompt_version_idx" ON "chat_messages" USING btree ("prompt_version");
CREATE INDEX IF NOT EXISTS "chat_messages_safety_score_idx" ON "chat_messages" USING btree ("safety_score");

CREATE TABLE IF NOT EXISTS "safety_review_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "message_id" uuid NOT NULL REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "label" text NOT NULL,
  "score" real NOT NULL,
  "reasoning" text,
  "reviewed" boolean DEFAULT false NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "safety_review_queue_user_id_idx" ON "safety_review_queue" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "safety_review_queue_message_id_idx" ON "safety_review_queue" USING btree ("message_id");
CREATE INDEX IF NOT EXISTS "safety_review_queue_reviewed_idx" ON "safety_review_queue" USING btree ("reviewed");
CREATE INDEX IF NOT EXISTS "safety_review_queue_created_at_idx" ON "safety_review_queue" USING btree ("created_at");

ALTER TABLE "safety_review_queue" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "safety_review_queue_select_own" ON "safety_review_queue";
DROP POLICY IF EXISTS "safety_review_queue_insert_own" ON "safety_review_queue";
DROP POLICY IF EXISTS "safety_review_queue_update_own" ON "safety_review_queue";
DROP POLICY IF EXISTS "safety_review_queue_delete_own" ON "safety_review_queue";

CREATE POLICY "safety_review_queue_select_own" ON "safety_review_queue" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "safety_review_queue_insert_own" ON "safety_review_queue" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "safety_review_queue_update_own" ON "safety_review_queue" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "safety_review_queue_delete_own" ON "safety_review_queue" FOR DELETE TO authenticated USING ("user_id" = auth.uid());
