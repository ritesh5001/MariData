# Filters — field spec & operator → SQL rules

The filter builder produces a `filterConfig` JSON object. The backend's
`filterConfigToWhereClause(config)` turns it into a parameterized WHERE clause
(`{ text: "... $1 ... $2 ...", values: [...] }`). **Never** interpolate user values or
unknown identifiers into SQL.

## filterConfig shape

```jsonc
{
  "op": "AND",                 // AND | OR  — combines this group's conditions
  "conditions": [
    { "field": "location_country", "operator": "in",      "value": ["US","GB"] },
    { "field": "person_seniority", "operator": "equals",   "value": "vp" },
    { "field": "email_confidence", "operator": "gte",      "value": 0.8 },
    {                            // nested group
      "op": "OR",
      "conditions": [
        { "field": "person_title", "operator": "contains", "value": "founder" },
        { "field": "person_title", "operator": "contains", "value": "ceo" }
      ]
    }
  ]
}
```

Groups nest arbitrarily; each group emits `(cond AND cond ...)` or `(cond OR cond ...)`.

## Allowed fields (whitelist)

Identifiers are validated against this set before use. Anything else is rejected (400).

`person_name, person_first_name, person_last_name, person_name_downcase, person_title,
person_functions, person_seniority, person_email_status, email_confidence, person_email,
person_phone, person_linkedin_url, person_detailed_function, person_title_normalized,
primary_title_faceting, organization_name, location_city, location_state, location_country,
location_postal_code, job_start_date, num_linkedin_connections, relevance_boost, modality,
tags, source_type, created_at`

## Operators → SQL

| operator | applies to | SQL emitted |
|---|---|---|
| `equals` | scalar | `field = $n` |
| `not_equals` | scalar | `field <> $n` |
| `in` | scalar | `field = ANY($n)` (`$n` = array) |
| `not_in` | scalar | `NOT (field = ANY($n))` |
| `contains` | text | `field ILIKE '%' || $n || '%'` |
| `starts_with` | text | `field ILIKE $n || '%'` |
| `gt`/`gte`/`lt`/`lte` | number/date | `field > $n` etc. |
| `between` | number/date | `field BETWEEN $n AND $n+1` (value = `[lo,hi]`) |
| `is_null` | any | `field IS NULL` (no value) |
| `is_not_null` | any | `field IS NOT NULL` (no value) |
| `array_contains` | TEXT[] field | `field @> ARRAY[$n]` (uses GIN index) |
| `fts` | (virtual) | `search_vector @@ plainto_tsquery('simple', $n)` |
| `fuzzy` | name/email/org | `field % $n` (pg_trgm similarity; needs trigram index) |

`contains` is the safe-but-slower text match; prefer `fts` for the global search box and
`fuzzy` for typo-tolerant name/email/org lookup (both index-backed).

## Type coercion

Per-field expected type is known from the schema. The builder coerces/validates values
(via Zod) before binding: numbers for numeric fields, ISO dates for date fields, arrays for
`in`/`array_contains`/`between`. Type mismatch → 400, never a raw DB error.

## Counts with filters

A filtered list request returns rows (keyset) plus an **approximate** total: the count
query runs with `SET LOCAL statement_timeout` and a `LIMIT 10001` guard — if it returns
10001 the UI shows `"10,000+"`. The unfiltered grand total always comes from
`pg_class.reltuples`. See `architecture.md`.

## Facets

Facet counts (`GROUP BY location_country`, `person_seniority`, `person_email_status`,
unnested `person_functions`) are computed over the **current filter** and capped/timed the
same way. Backed by the btree/GIN indexes on those columns.

## Segments

A saved segment is just a named `filterConfig` persisted in a `segments` table
(`id, name, filter_config JSONB, created_at`). Loading a segment re-runs the identical
filter — no materialization.
