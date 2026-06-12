# PHASE 3 — Search & Browse

**Status:** ✅ complete — 2026-06-12

---

## Agent Prompt

Build browsing and search over the `persons` table at 80M-row scale. Read
`.claude/docs/architecture.md` (pagination + counts) and `filters.md`.

---

## Deliverables

- `src/search/keyset.ts` — keyset paginator returning `{ rows, nextCursor }`
  (`WHERE id > $cursor ORDER BY id LIMIT n`). No OFFSET.
- `src/search/textSearch.ts` — FTS (`search_vector @@ plainto_tsquery('simple',$q)`) and
  fuzzy (`pg_trgm` `%`/`similarity`) on name/email/org.
- `src/search/counts.ts` — grand total from `pg_class.reltuples`; helper for capped
  (`LIMIT 10001`) filtered counts under `statement_timeout`.
- Routes: `GET /api/persons` (keyset list, optional `q` for FTS/fuzzy, sort), 
  `GET /api/persons/:id` (full record).
- Frontend: virtualized TanStack Table fed by an infinite TanStack Query (paging via
  `nextCursor`); global search box; column show/hide; row click → record detail drawer/page
  showing all fields (arrays/JSON rendered readably).

---

## Acceptance Criteria

- [ ] Browse scrolls smoothly through a large table via keyset paging (infinite scroll /
      load-more), no OFFSET in the SQL.
- [ ] Global search returns relevant rows via FTS; fuzzy name/email search tolerates typos.
- [ ] `EXPLAIN ANALYZE` shows GIN index hits for FTS and trigram queries.
- [ ] Grand total displays from `reltuples` instantly; no bare COUNT(*) in the list path.
- [ ] Record detail shows every field including arrays and JSON.
- [ ] List/search responses respect the 5s `statement_timeout`.
