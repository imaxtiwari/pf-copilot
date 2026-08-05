-- Store deterministic educational insight cards generated after CAS uploads.
CREATE TYPE insight_template AS ENUM (
  'personal_inflation_vs_cpi',
  'highest_lowest_real_return',
  'mid_small_cap_concentration',
  'unmatched_schemes'
);

CREATE TABLE portfolio_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cas_upload_id uuid REFERENCES cas_uploads(id) ON DELETE SET NULL,
  template insight_template NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX portfolio_insights_user_generated_idx
  ON portfolio_insights(user_id, generated_at);
