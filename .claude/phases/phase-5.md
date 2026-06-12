# PHASE 5 — CRUD, Dedup & Bulk ops

**Status:** ✅ complete — 2026-06-12

---

## Agent Prompt

Add record editing/deletion, duplicate detection + merge, and bulk operations over a
filtered set. Reuse `filterConfigToWhereClause` for the bulk target selection.

---

## Deliverables

- Routes: `PATCH /api/persons/:id` (Zod-validated partial update), `DELETE /api/persons/:id`.
- Dedup: `src/dedup/` — find duplicate groups by `person_email`, `person_linkedin_url`, and
  `person_name_downcase + organization_name`. `GET /api/dedup?key=email` returns groups
  (keyset over group keys, capped). `POST /api/dedup/merge` merges a group into a surviving
  row (keep most-complete / newest; coalesce non-null fields; union array fields; delete the
  rest) in a transaction.
- Bulk: `POST /api/bulk/tag` and `POST /api/bulk/delete` taking a `filterConfig` (+ optional
  explicit id list); executed set-based in batches with a returned affected count. Bulk
  delete requires an explicit confirm flag.
- Frontend: editable record detail; Dedup review UI (group, pick survivor, merge); bulk
  toolbar on the Browse page (tag / delete current filter) with a confirm dialog showing the
  affected-count estimate.

---

## Acceptance Criteria

- [ ] Editing a record persists and is reflected in search/browse.
- [ ] Deleting a record removes it everywhere.
- [ ] Duplicate groups surface for each key; merge keeps one row, coalesces fields, unions
      arrays, deletes the others — all in one transaction.
- [ ] Bulk tag/delete over a filtered set is set-based (not row-by-row) and returns an
      accurate affected count; delete needs explicit confirmation.
- [ ] Bulk target selection reuses `filterConfigToWhereClause` (no duplicated SQL logic).
