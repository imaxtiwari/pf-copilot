-- Demat holdings and stock document RAG corpus

CREATE TYPE document_source AS ENUM ('annual_report', 'bse_announcement', 'other');

CREATE TABLE IF NOT EXISTS demat_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  isin text NOT NULL,
  company_name text NOT NULL,
  quantity numeric NOT NULL,
  price numeric NOT NULL,
  value numeric NOT NULL,
  as_of_date date NOT NULL,
  source holding_source NOT NULL,
  cas_upload_id uuid REFERENCES cas_uploads(id),
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demat_holdings_user_isin_idx ON demat_holdings(user_id, isin);
CREATE INDEX IF NOT EXISTS demat_holdings_user_date_idx ON demat_holdings(user_id, as_of_date);

CREATE TABLE IF NOT EXISTS stock_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isin text NOT NULL,
  company_name text NOT NULL,
  document_date date NOT NULL,
  source document_source NOT NULL,
  section text NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536),
  source_url text NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_documents_isin_idx ON stock_documents(isin);
CREATE UNIQUE INDEX IF NOT EXISTS stock_documents_unique_idx
  ON stock_documents(isin, source, document_date, section, chunk_text);

-- DOWN MIGRATION:
-- DROP INDEX IF EXISTS stock_documents_unique_idx;
-- DROP INDEX IF EXISTS stock_documents_isin_idx;
-- DROP TABLE IF EXISTS stock_documents;
-- DROP INDEX IF EXISTS demat_holdings_user_date_idx;
-- DROP INDEX IF EXISTS demat_holdings_user_isin_idx;
-- DROP TABLE IF EXISTS demat_holdings;
-- DROP TYPE IF EXISTS document_source;
