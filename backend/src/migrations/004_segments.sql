-- Saved segments: a named filterConfig. Loading a segment re-runs the identical filter —
-- nothing is materialized.

CREATE TABLE IF NOT EXISTS segments (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  filter_config JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
