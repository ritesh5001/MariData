# PHASE 4 — Filters & Facets

**Status:** ⏳ pending

---

## Agent Prompt

Build the AND/OR filter builder, faceted counts, and saved segments. Read
`.claude/docs/filters.md` — implement `filterConfigToWhereClause` exactly to that spec.

---

## Deliverables

- `src/search/filterConfigToWhereClause.ts` — converts nested `filterConfig` (AND/OR
  groups) into `{ text, values }` with `$n` placeholders. Field names validated against the
  whitelist; operators mapped per `filters.md`. Zod-validate the config + per-field value
  type coercion. Unit tests for each operator and for injection attempts.
- Wire filters into `GET /api/persons` (filter + search + keyset together) and into the
  capped filtered count.
- `GET /api/facets` — counts grouped by country / seniority / email_status / function
  (unnested), over the current filter, capped + timed.
- `segments` table + `005_segments.sql`; routes `POST/GET/DELETE /api/segments`.
- Frontend: FilterBuilder UI (nested AND/OR groups, per-field operator + value inputs typed
  by field), FacetPanel (live counts, click-to-add-filter), Save/Load segment UI.

---

## Acceptance Criteria

- [ ] Complex nested AND/OR filters return correct rows; verified against hand-written SQL.
- [ ] Every value is bound as `$n`; identifier whitelist rejects unknown fields (400). An
      injection attempt in a value or field is neutralized (covered by tests).
- [ ] Facet counts match the filtered set and respect the timeout/cap.
- [ ] Saving a filter as a named segment and reloading it reproduces the exact result set.
- [ ] `array_contains`/`in` use GIN/btree indexes (`EXPLAIN` confirms).
