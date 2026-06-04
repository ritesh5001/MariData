-- Ingestion support: staging table, job/error tracking, and guarded cast helpers.
-- The heavy GIN/btree search indexes are NOT here; they are built after the first bulk
-- load by src/ingest/indexes.sql (index-after-load contract). Only structural objects
-- that must pre-exist live in this migration.

-- Staging: all-TEXT, UNLOGGED (no WAL — it's scratch, fine to lose on crash). Columns are
-- in the EXACT physical order of the source TSV so a plain COPY maps positionally.
CREATE UNLOGGED TABLE IF NOT EXISTS persons_staging (
  person_name                                  TEXT,
  person_first_name_unanalyzed                 TEXT,
  person_last_name_unanalyzed                  TEXT,
  person_name_unanalyzed_downcase              TEXT,
  person_title                                 TEXT,
  person_functions                             TEXT,
  person_seniority                             TEXT,
  person_email_status_cd                       TEXT,
  person_extrapolated_email_confidence         TEXT,
  person_email                                 TEXT,
  person_phone                                 TEXT,
  person_sanitized_phone                       TEXT,
  person_email_analyzed                        TEXT,
  person_linkedin_url                          TEXT,
  person_detailed_function                     TEXT,
  person_title_normalized                      TEXT,
  primary_title_normalized_for_faceting        TEXT,
  sanitized_organization_name_unanalyzed       TEXT,
  person_location_city                         TEXT,
  person_location_city_with_state_or_country   TEXT,
  person_location_state                        TEXT,
  person_location_state_with_country           TEXT,
  person_location_country                      TEXT,
  person_location_postal_code                  TEXT,
  job_start_date                               TEXT,
  current_organization_ids                     TEXT,
  modality                                     TEXT,
  prospected_by_team_ids                       TEXT,
  person_excluded_by_team_ids                  TEXT,
  relavence_boost                              TEXT,
  person_num_linkedin_connections             TEXT,
  person_location_geojson                      TEXT,
  predictive_scores                            TEXT,
  person_vacuumed_at                           TEXT,
  random                                       TEXT,
  src_index                                    TEXT,
  src_type                                     TEXT,
  src_id                                       TEXT,
  src_score                                    TEXT
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT,
  mode            TEXT NOT NULL DEFAULT 'insert',   -- insert | upsert
  status          TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  stage           TEXT,                             -- staging | transform | quarantine | indexing | done
  rows_staged     BIGINT NOT NULL DEFAULT 0,
  rows_inserted   BIGINT NOT NULL DEFAULT 0,
  rows_conflicted BIGINT NOT NULL DEFAULT 0,
  rows_errored    BIGINT NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_errors (
  id          BIGSERIAL PRIMARY KEY,
  job_id      BIGINT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  external_id TEXT,
  column_name TEXT NOT NULL,
  raw_value   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_errors_job_idx ON import_errors(job_id);

-- ----------------------------------------------------------------------------
-- Guarded cast helpers. Each returns NULL on empty/invalid input instead of raising,
-- so one dirty value never aborts the set-based transform. IMMUTABLE so the planner can
-- inline/optimize.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION maridata_to_real(v TEXT) RETURNS REAL AS $$
BEGIN
  RETURN NULLIF(btrim(v), '')::REAL;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION maridata_to_int(v TEXT) RETURNS INTEGER AS $$
BEGIN
  RETURN round(NULLIF(btrim(v), '')::NUMERIC)::INTEGER;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION maridata_to_date(v TEXT) RETURNS DATE AS $$
BEGIN
  RETURN NULLIF(btrim(v), '')::DATE;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION maridata_to_timestamptz(v TEXT) RETURNS TIMESTAMPTZ AS $$
BEGIN
  RETURN NULLIF(btrim(v), '')::TIMESTAMPTZ;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION maridata_to_jsonb(v TEXT) RETURNS JSONB AS $$
BEGIN
  IF v IS NULL OR btrim(v) = '' OR lower(btrim(v)) = 'null' THEN RETURN NULL; END IF;
  RETURN btrim(v)::JSONB;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Parse a text-array column that may be a JSON array ["a","b"], or a comma/pipe-delimited
-- string. Returns NULL for empty / "[]" / "null".
CREATE OR REPLACE FUNCTION maridata_parse_text_array(v TEXT) RETURNS TEXT[] AS $$
DECLARE
  trimmed TEXT;
  arr     TEXT[];
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  trimmed := btrim(v);
  IF trimmed = '' OR trimmed = '[]' OR lower(trimmed) = 'null' THEN RETURN NULL; END IF;

  IF left(trimmed, 1) = '[' THEN
    BEGIN
      SELECT array_agg(x) INTO arr
      FROM json_array_elements_text(trimmed::json) AS x;
      RETURN arr;
    EXCEPTION WHEN others THEN
      -- not valid JSON; fall through to delimiter split
    END;
  END IF;

  IF position('|' IN trimmed) > 0 THEN
    arr := string_to_array(trimmed, '|');
  ELSE
    arr := string_to_array(trimmed, ',');
  END IF;

  SELECT array_agg(btrim(e)) INTO arr
  FROM unnest(arr) AS e
  WHERE btrim(e) <> '';
  RETURN arr;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
