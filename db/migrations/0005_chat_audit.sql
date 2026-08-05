-- Add transparency/audit fields to chat_messages for citations, model version, refusal reason, and request ID.

ALTER TABLE chat_messages
  ADD COLUMN citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN model_version text,
  ADD COLUMN refusal_reason text,
  ADD COLUMN request_id text;

CREATE INDEX chat_messages_request_id_idx ON chat_messages(request_id);

-- DOWN MIGRATION (run manually to reverse):
-- DROP INDEX IF EXISTS chat_messages_request_id_idx;
-- ALTER TABLE chat_messages
--   DROP COLUMN IF EXISTS citations,
--   DROP COLUMN IF EXISTS model_version,
--   DROP COLUMN IF EXISTS refusal_reason,
--   DROP COLUMN IF EXISTS request_id;
