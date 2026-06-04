-- Heavy search indexes. Built AFTER the first bulk load (index-after-load contract),
-- run by indexAfterLoad.ts — NOT by the migration runner. All IF NOT EXISTS so it is safe
-- to invoke repeatedly; it only does work when an index is missing.

CREATE INDEX IF NOT EXISTS persons_search_vector_gin  ON persons USING gin (search_vector);
CREATE INDEX IF NOT EXISTS persons_name_trgm          ON persons USING gin (person_name_downcase gin_trgm_ops);
CREATE INDEX IF NOT EXISTS persons_email_trgm         ON persons USING gin (person_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS persons_org_trgm           ON persons USING gin (organization_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS persons_functions_gin      ON persons USING gin (person_functions);
CREATE INDEX IF NOT EXISTS persons_country_btree      ON persons (location_country);
CREATE INDEX IF NOT EXISTS persons_state_btree        ON persons (location_state);
CREATE INDEX IF NOT EXISTS persons_seniority_btree    ON persons (person_seniority);
CREATE INDEX IF NOT EXISTS persons_email_status_btree ON persons (person_email_status);
CREATE INDEX IF NOT EXISTS persons_email_btree        ON persons (person_email);
