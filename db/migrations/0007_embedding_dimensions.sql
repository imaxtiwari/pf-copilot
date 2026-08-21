-- Widen embedding columns to match Azure text-embedding-3-large (3072 dims)

DROP INDEX IF EXISTS factsheet_chunks_embedding_hnsw_idx;
DROP INDEX IF EXISTS stock_documents_embedding_hnsw_idx;

-- Existing 1536-dim vectors are incompatible with the new 3072-dim model.
-- Clear embeddings so the column type can be changed without data loss in other columns.
UPDATE factsheet_chunks SET embedding = NULL;
UPDATE stock_documents SET embedding = NULL;

ALTER TABLE factsheet_chunks ALTER COLUMN embedding TYPE vector(3072);
ALTER TABLE stock_documents ALTER COLUMN embedding TYPE vector(3072);

CREATE INDEX IF NOT EXISTS factsheet_chunks_embedding_hnsw_idx
  ON factsheet_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS stock_documents_embedding_hnsw_idx
  ON stock_documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
