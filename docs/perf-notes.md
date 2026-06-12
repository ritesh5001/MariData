# Performance notes — hot query verification

Measured on the dev dataset (200k rows after the 200k-row import test; PostgreSQL 16.14)
with `EXPLAIN (ANALYZE, BUFFERS)`. The shapes below are what matter at 80M rows: every
hot path is index-backed or hard-capped, and nothing scans the full table in a request.

## Results

| Query | Plan | Time @200k |
|---|---|---|
| Keyset list page (`id > cursor ORDER BY id LIMIT 100`) | Index Scan `persons_pkey` | 0.3 ms |
| FTS (`search_vector @@ plainto_tsquery`) | GIN bitmap (`persons_search_vector_gin`); planner may prefer pkey scan when combined with `ORDER BY id LIMIT n` on small tables | 22 ms |
| Fuzzy (`person_name_downcase % $1`) | `persons_name_trgm` GIN (verified with `enable_seqscan=off`; at 200k the planner correctly prefers a seq scan because the table is tiny) | 2.6 ms |
| Filtered count (capped `LIMIT 10001`) | Index Only Scan `persons_country_btree` | 18 ms |
| Facet sample (50k-row sample, GROUP BY) | Index Only Scan + HashAggregate, bounded by `LIMIT 50000` | 103 ms |
| `array_contains` (`person_functions @> ARRAY[$1]`) | `persons_functions_gin` (verified with `enable_seqscan=off`) | 0.3 ms |
| Grand total (`pg_class.reltuples`) | catalog lookup | 0.04 ms |

## Planner notes

- At 200k rows the planner sometimes picks a sequential scan over GIN because the whole
  table fits in a few hundred buffers — that is the planner being right, not the index
  being unused. With `enable_seqscan = off` every query above switches to its intended
  index, which is the plan shape that wins at 8M+ rows.
- The FTS + `ORDER BY id LIMIT n` combination lets the planner choose between the GIN
  index (filter-then-sort) and the pkey index (scan-in-order-then-filter). Both are
  bounded; on selective queries it uses GIN.

## Timeouts and caps (enforced in code)

| Path | Guard |
|---|---|
| List / search page | `SET LOCAL statement_timeout = 5000` (keyset.ts) |
| Filtered count | `LIMIT 10001` cap + 3s timeout (counts.ts) |
| Facets | 50k-row sample + 5s timeout per facet (facets.ts) |
| Dedup group scan | 10s timeout, keyset over group key (dedup.ts) |
| Export | no timeout, `pg-cursor` batches of 5000 — RSS stayed flat at 65 MB through a 200k-row / 35 MB export |
| Import COPY | streaming, no timeout; `synchronous_commit = off` on the load session |

## Pool

Single `pg.Pool` (max 10). COPY loads, exports, and merges check out dedicated clients;
request handlers never share a transaction with a long operation. BIGINT (OID 20) parses
to JS number (safe below 2^53 — ids and counts qualify).
