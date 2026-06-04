# Ingestion — the COPY pipeline contract

The whole platform lives or dies on getting 30 GB / 80M rows into Postgres fast and
safely. The only acceptable mechanism is **streaming `COPY FROM STDIN`**. INSERT loops,
ORMs, and per-row round-trips are forbidden for bulk load.

## Pipeline stages

```
TSV (upload stream or server path)
   │  (1) stream rows, no full-file buffering
   ▼
persons_staging  (all TEXT, no indexes, UNLOGGED)
   │  COPY persons_staging (col1..col39) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', HEADER true, QUOTE '"')
   ▼
   │  (2) single transforming INSERT with casts/cleaning
INSERT INTO persons (...) SELECT <cast/clean each col> FROM persons_staging
   ON CONFLICT (external_id) DO NOTHING            -- or DO UPDATE in "upsert" mode
   │
   ▼
   │  (3) build indexes (003_indexes.sql) — only on first/empty-table load
   │  (4) ANALYZE persons
   ▼
done — job summary persisted
```

## Stage detail

1. **Stream in.** Accept either a multipart upload (piped straight into COPY, never written
   whole to disk) or a `serverPath` to a local file (preferred for the real 30 GB file —
   read with a file stream). Use `pg-copy-streams` `from()` and `pipe()` the TSV reader into
   it. Backpressure is handled by the stream; memory stays flat.
2. **Transform.** After staging is loaded, one set-based `INSERT ... SELECT` casts every
   column per `.claude/docs/schema.md` parsing rules. Guarded casts (`NULLIF`, safe
   `to_date`/`to_timestamp`, JSON validation) keep one bad value from killing a row.
3. **Index after load.** Indexes are created only when loading into an empty table (initial
   import). Incremental imports into an already-indexed table skip this and rely on the
   live indexes. Creating GIN indexes on 80M rows mid-COPY is the classic mistake — don't.
4. **ANALYZE** so the planner and `reltuples` estimate are fresh.

## Performance knobs (set on the load connection only)

```sql
SET synchronous_commit = off;
SET maintenance_work_mem = '1GB';   -- speeds CREATE INDEX
-- persons_staging is UNLOGGED + TRUNCATEd between imports
```

`persons_staging` is `UNLOGGED` (no WAL) — it's a scratch table, fine to lose on crash.

## Chunking & resume

- COPY itself streams the whole file in one statement; progress is tracked by counting
  bytes/lines consumed from the source stream (emitted over SSE).
- For resume after failure: the staging load is idempotent (TRUNCATE staging, re-COPY).
  The transform uses `ON CONFLICT (external_id) DO NOTHING`, so re-running it never
  duplicates and effectively resumes.

## Error handling / quarantine

- Malformed TSV lines that COPY itself rejects abort the COPY (Postgres is strict). To
  survive dirty data, staging columns are all `TEXT` and the delimiter/quote config is
  permissive, so COPY rarely rejects; cast failures are caught in the **transform** step.
- Rows whose JSON/date/number casts fail are not silently dropped: the transform writes the
  offending `external_id` + column + raw value into an `import_errors` table tied to the
  job. The row is still inserted with `NULL` in the bad column where safe.

## Import job tracking

`import_jobs` table: `id`, `filename`, `mode` (insert|upsert), `status`
(running|completed|failed), `rows_staged`, `rows_inserted`, `rows_conflicted`,
`rows_errored`, `started_at`, `finished_at`, `error_message`. Every import creates one
row; the UI history reads from here. SSE streams live `{stage, rowsProcessed, percent}`.

## Acceptance target

A multi-GB TSV loads end-to-end via COPY in tens of minutes (not days), progress streams
live, bad values are quarantined (not fatal), indexes exist afterward, and the job summary
row counts reconcile (`staged = inserted + conflicted + errored_dropped`).
