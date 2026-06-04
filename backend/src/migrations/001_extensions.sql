-- Core extensions. pg_trgm/unaccent/btree_gin ship with Postgres contrib.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- pgvector is reserved for future semantic search. Create it only if the extension's
-- files are actually installed, so the migration never fails on a box without pgvector.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    RAISE NOTICE 'pgvector enabled';
  ELSE
    RAISE NOTICE 'pgvector not available - skipping (semantic search reserved for later)';
  END IF;
END
$$;
