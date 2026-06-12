// WHERE-fragment builders for the global search box. Both shapes are GIN-index-backed:
// FTS hits persons_search_vector_gin, fuzzy hits the pg_trgm indexes on name/email/org.
// Fragments are parameterized; the caller supplies the next free $n index.

export interface SqlFragment {
  clause: string;
  values: unknown[];
}

export function ftsCondition(q: string, startIdx: number): SqlFragment {
  return {
    clause: `search_vector @@ plainto_tsquery('simple', $${startIdx})`,
    values: [q],
  };
}

export function fuzzyCondition(q: string, startIdx: number): SqlFragment {
  const p = `$${startIdx}`;
  return {
    clause: `(person_name_downcase % ${p} OR person_email % ${p} OR organization_name % ${p})`,
    values: [q.toLowerCase()],
  };
}

// Ranking expression for fuzzy results (best match first). Uses the same single parameter
// index as fuzzyCondition so the bound value is shared.
export function fuzzyRank(startIdx: number): string {
  const p = `$${startIdx}`;
  return `GREATEST(
    similarity(coalesce(person_name_downcase, ''), ${p}),
    similarity(coalesce(person_email, ''), ${p}),
    similarity(coalesce(organization_name, ''), ${p})
  )`;
}
