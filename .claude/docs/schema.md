# Schema — TSV columns → Postgres

The source TSV has 38 columns (tab-separated, header row). They map to the `persons`
table as below. Loading is two-stage: every column lands in `persons_staging` as raw
`TEXT`, then a transforming `INSERT` casts/cleans into the typed `persons` table.

## Column map

| # | TSV column | `persons` column | Type | Notes |
|---|---|---|---|---|
| 1 | person_name | person_name | TEXT | |
| 2 | person_first_name_unanalyzed | person_first_name | TEXT | |
| 3 | person_last_name_unanalyzed | person_last_name | TEXT | |
| 4 | person_name_unanalyzed_downcase | person_name_downcase | TEXT | trigram index (fuzzy) |
| 5 | person_title | person_title | TEXT | |
| 6 | person_functions | person_functions | TEXT[] | array-split (see parsing) |
| 7 | person_seniority | person_seniority | TEXT | btree (facet) |
| 8 | person_email_status_cd | person_email_status | TEXT | btree (facet) |
| 9 | person_extrapolated_email_confidence | email_confidence | REAL | |
| 10 | person_email | person_email | TEXT | btree (dedup) + trigram |
| 11 | person_phone | person_phone | TEXT | |
| 12 | person_sanitized_phone | person_sanitized_phone | TEXT | |
| 13 | person_email_analyzed | person_email_analyzed | TEXT | |
| 14 | person_linkedin_url | person_linkedin_url | TEXT | dedup key |
| 15 | person_detailed_function | person_detailed_function | TEXT | |
| 16 | person_title_normalized | person_title_normalized | TEXT | |
| 17 | primary_title_normalized_for_faceting | primary_title_faceting | TEXT | btree (facet) |
| 18 | sanitized_organization_name_unanalyzed | organization_name | TEXT | trigram index (fuzzy) |
| 19 | person_location_city | location_city | TEXT | |
| 20 | person_location_city_with_state_or_country | location_city_full | TEXT | |
| 21 | person_location_state | location_state | TEXT | btree (facet) |
| 22 | person_location_state_with_country | location_state_full | TEXT | |
| 23 | person_location_country | location_country | TEXT | btree (facet) |
| 24 | person_location_postal_code | location_postal_code | TEXT | |
| 25 | job_start_date | job_start_date | DATE | nullable cast |
| 26 | current_organization_ids | current_organization_ids | TEXT[] | array-split |
| 27 | modality | modality | TEXT | |
| 28 | prospected_by_team_ids | prospected_by_team_ids | TEXT[] | array-split |
| 29 | person_excluded_by_team_ids | excluded_by_team_ids | TEXT[] | array-split |
| 30 | relavence_boost | relevance_boost | REAL | (sic: source typo) |
| 31 | person_num_linkedin_connections | num_linkedin_connections | INTEGER | nullable cast |
| 32 | person_location_geojson | location_geojson | JSONB | nullable cast |
| 33 | predictive_scores | predictive_scores | JSONB | nullable cast |
| 34 | person_vacuumed_at | person_vacuumed_at | TIMESTAMPTZ | nullable cast |
| 35 | random | random | REAL | |
| 36 | _index | source_index | TEXT | provenance |
| 37 | _type | source_type | TEXT | provenance |
| 38 | _id | external_id | TEXT | UNIQUE — natural key |
| 39 | _score | source_score | REAL | |

Plus platform columns:

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PRIMARY KEY | surrogate; keyset pagination cursor |
| search_vector | tsvector | GENERATED from name + title + organization + email |
| embedding | vector(1536) | **nullable, reserved** (only added if `vector` ext present) |
| tags | TEXT[] | bulk-tagging (Phase 5) |
| created_at | TIMESTAMPTZ DEFAULT now() | |

## Parsing rules (staging → typed)

- **Array columns** (`person_functions`, `*_team_ids`, `current_organization_ids`): source
  may be JSON-ish `["a","b"]`, comma-, or pipe-separated. The transform normalizes to a
  Postgres `TEXT[]`; empty/`null`/`[]` → `NULL`.
- **Numeric** (`REAL`/`INTEGER`): empty string → `NULL`; use `NULLIF(col,'')::type`.
- **DATE / TIMESTAMPTZ**: empty/invalid → `NULL` (guarded cast).
- **JSONB** (`location_geojson`, `predictive_scores`): validate; invalid JSON → `NULL`,
  quarantine the raw value in the import error log rather than failing the row.
- **external_id**: required + UNIQUE. Duplicate `_id` on import → `ON CONFLICT (external_id)
  DO NOTHING` (or update, per import mode), counted in the job summary.

## `search_vector` (FTS)

Generated column:

```
to_tsvector('simple',
  coalesce(person_name,'') || ' ' ||
  coalesce(person_title,'') || ' ' ||
  coalesce(organization_name,'') || ' ' ||
  coalesce(person_email,''))
```

`'simple'` (not `'english'`) — names/titles aren't English prose; we want literal tokens,
backed by `pg_trgm` for fuzzy/typo matching.

## Indexes (migration `003_indexes.sql`, run AFTER bulk load)

```sql
CREATE INDEX persons_search_vector_gin   ON persons USING gin (search_vector);
CREATE INDEX persons_name_trgm           ON persons USING gin (person_name_downcase gin_trgm_ops);
CREATE INDEX persons_email_trgm          ON persons USING gin (person_email gin_trgm_ops);
CREATE INDEX persons_org_trgm            ON persons USING gin (organization_name gin_trgm_ops);
CREATE INDEX persons_functions_gin       ON persons USING gin (person_functions);
CREATE INDEX persons_country_btree       ON persons (location_country);
CREATE INDEX persons_state_btree         ON persons (location_state);
CREATE INDEX persons_seniority_btree     ON persons (person_seniority);
CREATE INDEX persons_email_status_btree  ON persons (person_email_status);
CREATE INDEX persons_email_btree         ON persons (person_email);
-- external_id UNIQUE index created with the table.
```

Run `ANALYZE persons;` after index creation so `reltuples` and the planner are current.
