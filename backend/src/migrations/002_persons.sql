-- Main typed table. See .claude/docs/schema.md for the full TSV->column mapping.
-- Indexes are intentionally NOT created here; they are built after the bulk load
-- (migration 003 in Phase 2) per the scale contract.

CREATE TABLE IF NOT EXISTS persons (
  id                        BIGSERIAL PRIMARY KEY,

  -- identity / names
  person_name               TEXT,
  person_first_name         TEXT,
  person_last_name          TEXT,
  person_name_downcase      TEXT,

  -- role
  person_title              TEXT,
  person_functions          TEXT[],
  person_seniority          TEXT,

  -- contact
  person_email_status       TEXT,
  email_confidence          REAL,
  person_email              TEXT,
  person_phone              TEXT,
  person_sanitized_phone    TEXT,
  person_email_analyzed     TEXT,
  person_linkedin_url       TEXT,

  -- normalized role
  person_detailed_function  TEXT,
  person_title_normalized   TEXT,
  primary_title_faceting    TEXT,

  -- org
  organization_name         TEXT,
  current_organization_ids  TEXT[],

  -- location
  location_city             TEXT,
  location_city_full        TEXT,
  location_state            TEXT,
  location_state_full       TEXT,
  location_country          TEXT,
  location_postal_code      TEXT,
  location_geojson          JSONB,

  -- employment / scoring
  job_start_date            DATE,
  modality                  TEXT,
  prospected_by_team_ids    TEXT[],
  excluded_by_team_ids      TEXT[],
  relevance_boost           REAL,
  num_linkedin_connections  INTEGER,
  predictive_scores         JSONB,
  person_vacuumed_at        TIMESTAMPTZ,
  random                    REAL,

  -- provenance (from _index/_type/_id/_score)
  source_index              TEXT,
  source_type               TEXT,
  external_id               TEXT,
  source_score              REAL,

  -- platform
  tags                      TEXT[],
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- full-text search vector (GIN index built in Phase 2)
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(person_name, '') || ' ' ||
      coalesce(person_title, '') || ' ' ||
      coalesce(organization_name, '') || ' ' ||
      coalesce(person_email, ''))
  ) STORED
);

-- external_id is the natural key from the source `_id`; unique + used for dedup on import.
-- Created here (not deferred) because ON CONFLICT (external_id) during import needs it.
CREATE UNIQUE INDEX IF NOT EXISTS persons_external_id_uniq
  ON persons (external_id) WHERE external_id IS NOT NULL;

-- Reserved semantic-search column: added only when pgvector is installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE persons ADD COLUMN IF NOT EXISTS embedding vector(1536)';
    RAISE NOTICE 'persons.embedding column added (pgvector present)';
  ELSE
    RAISE NOTICE 'skipping persons.embedding (pgvector not installed)';
  END IF;
END
$$;
