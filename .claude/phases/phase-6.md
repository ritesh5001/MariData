# PHASE 6 — Export, Dashboard & Polish

**Status:** ✅ complete — 2026-06-12

---

## Agent Prompt

Add streaming export, a stats dashboard, and a performance pass. Read
`.claude/docs/architecture.md` (export cursor + counts).

---

## Deliverables

- `src/export/streamExport.ts` — server-side `Cursor` (node-postgres `pg-cursor`) over the
  filtered set; write CSV/TSV chunks directly to the HTTP response. No `statement_timeout`,
  no in-memory buffering. Column selection + filter from the request.
- Route `GET /api/export?format=csv|tsv` (filter via query/body) → `Content-Disposition`
  attachment, chunked transfer.
- `GET /api/stats` — grand total via `reltuples`, table/index disk size
  (`pg_total_relation_size`), top countries/titles (capped facet), recent import jobs.
- Frontend: Export button on Browse (respects current filter + visible columns, shows
  progress); Dashboard page (row count, disk size, top facets, import-job status cards).
- Perf pass: `EXPLAIN (ANALYZE, BUFFERS)` on the hot queries (list, FTS, fuzzy, facets,
  filtered count); confirm index usage; tune pool size + `statement_timeout`; document
  findings in `docs/perf-notes.md`.
- Final QA: walk every prior phase's acceptance criteria; run the `data-reviewer` agent.

---

## Acceptance Criteria

- [ ] A large filtered export streams to a file without OOM (cursor-based, verified flat memory).
- [ ] Exported CSV/TSV reflects the active filter and selected columns; opens correctly.
- [ ] Dashboard loads instantly using `reltuples` + size estimates (no full COUNT(*)).
- [ ] `EXPLAIN` confirms index usage on all hot queries; findings in `docs/perf-notes.md`.
- [ ] `data-reviewer` agent reports no HIGH issues across the codebase.
- [ ] All Phase 1–5 acceptance criteria still pass.
