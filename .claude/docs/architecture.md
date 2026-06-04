# Architecture — scaling decisions

Everything here exists because the table holds ~80M rows. These are the rules that keep
queries sub-second and memory flat.

## Connection pooling

One `pg.Pool` (default max ~10) shared across the API. A separate, dedicated client is
checked out for long operations (COPY load, streaming export) so they don't starve the
pool. Per-query-class `statement_timeout` is set with `SET LOCAL` inside a transaction:

| Query class | statement_timeout |
|---|---|
| list / search (keyset page) | 5s |
| facet counts | 5s |
| filtered count guard | 3s |
| export (streaming) | none (cursor-based) |
| import transform | none |

## Pagination — keyset only

Browsing uses keyset (seek) pagination:

```sql
SELECT ... FROM persons
WHERE id > $cursor              -- plus any filter WHERE
ORDER BY id
LIMIT $limit;
```

The API returns `{ rows, nextCursor }` where `nextCursor = last row's id`. Offset
pagination (`OFFSET n`) is banned beyond the first page — `OFFSET 5_000_000` scans and
discards 5M rows every request. The UI's table is infinite-scroll / "load more", not
numbered pages, so keyset fits naturally.

When a sort other than `id` is requested, keyset uses a composite cursor
`(sort_col, id) > ($a, $b)` with a matching composite index, or falls back to a bounded
window. Default sort is `id` (insertion order) which needs no extra index.

## Counts — never bare COUNT(\*)

- **Grand total (unfiltered):** read `reltuples::bigint` from `pg_class` for `persons`.
  Instant, approximate, refreshed by `ANALYZE`. Displayed as "~80,000,000".
- **Filtered total:** run the filter query wrapped in `SELECT count(*) FROM (… LIMIT 10001)`
  under a short `statement_timeout`. 10001 → show `"10,000+"`. Timeout → show `"many"`.
- A bare `COUNT(*)` over the whole filtered table in the hot path is forbidden — it forces
  a full index/heap scan.

## Search

- **Global search box:** `search_vector @@ plainto_tsquery('simple', $q)`, GIN-indexed.
- **Fuzzy name/email/org:** `pg_trgm` similarity (`%` operator / `similarity()`), GIN
  trigram index. Used for typo-tolerant lookup.
- **Exact / range filters:** btree indexes on facet columns; `@>` GIN for array fields.

## Ingestion

See `ingestion.md`. Streaming `COPY` into UNLOGGED staging → set-based transform →
index-after-load → `ANALYZE`. The single most important performance decision in the app.

## Export

Server-side cursor (`DECLARE … CURSOR` / node-postgres `Cursor`) reads the filtered set in
batches and writes CSV/TSV chunks straight to the HTTP response stream. A 1M-row export
holds only one batch in memory at a time. No `statement_timeout`.

## Frontend data flow

TanStack Query owns server state (search, filters, facets, record detail). The results
grid is a **virtualized** TanStack Table — only visible rows are in the DOM — fed by an
infinite query keyed on `(filterConfig, search, sort)`, paging via `nextCursor`.

## Auth (single admin)

`ADMIN_PASSWORD_HASH` (bcrypt) in env. `POST /auth/login` compares the password, issues a
JWT (`JWT_SECRET`, ~12h) as an httpOnly cookie. `requireAuth` middleware guards every
`/api/*` route except `/health` and `/auth/login`. No user table, no roles.

## Why no ORM

At this scale the query shapes (keyset, FTS, trigram, GIN array, COPY, cursors, reltuples
counts) are exactly the things ORMs hide or do badly. Raw parameterized `pg` queries +
`filterConfigToWhereClause` give full control of the plan with zero injection risk
(values bound as `$n`, identifiers whitelisted).
