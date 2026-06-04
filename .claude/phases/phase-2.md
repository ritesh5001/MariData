# PHASE 2 — Ingestion Engine (critical)

**Status:** ⏳ pending

---

## Agent Prompt

Build the streaming `COPY` ingestion pipeline — the heart of MariData. Read
`.claude/docs/ingestion.md` and `.claude/docs/schema.md`. INSERT loops are forbidden.

---

## Deliverables

- Migration `003_indexes.sql` (all indexes from `schema.md`) + `004_staging_meta.sql`
  (`persons_staging` UNLOGGED all-TEXT, `import_jobs`, `import_errors`).
- `src/ingest/copyLoader.ts` — stream a TSV (upload OR `serverPath`) into
  `persons_staging` via `pg-copy-streams` `COPY ... FROM STDIN (FORMAT csv, DELIMITER tab,
  HEADER true)`. Dedicated client, not the pool. Tracks bytes/lines for progress.
- `src/ingest/transform.ts` — set-based `INSERT INTO persons SELECT <guarded casts>
  FROM persons_staging ON CONFLICT (external_id) DO NOTHING|UPDATE`; writes cast failures
  to `import_errors`. Sets `synchronous_commit=off`, `maintenance_work_mem`.
- `src/ingest/indexAfterLoad.ts` — run `003_indexes.sql` only when loading into an empty
  table; then `ANALYZE persons`.
- `src/ingest/jobTracker.ts` — create/update `import_jobs` rows; reconcile counts.
- Routes: `POST /api/import` (multipart stream or `{serverPath}`), `GET /api/import/:id`,
  `GET /api/import/:id/stream` (SSE live progress), `GET /api/imports` (history).
- Frontend Import Wizard: file/path picker → column-mapping preview (first N rows) → start
  → live SSE progress bar → summary (staged/inserted/conflicted/errored). Import history list.
- A `scripts/make-sample-tsv.ts` generating a few hundred valid 39-column rows for testing.

---

## Acceptance Criteria

- [ ] A multi-MB sample TSV loads end-to-end via streaming COPY (verified: no INSERT loop,
      memory stays flat).
- [ ] SSE progress streams live during ingest; the wizard shows a moving bar.
- [ ] Bad date/JSON/number values are quarantined in `import_errors`, not fatal.
- [ ] Indexes from `003_indexes.sql` exist after an initial load; `ANALYZE` has run.
- [ ] Re-running the same import does not duplicate rows (`ON CONFLICT external_id`).
- [ ] `import_jobs` summary reconciles: `staged = inserted + conflicted + errored`.
- [ ] `GET /api/imports` returns history with counts and timing.
