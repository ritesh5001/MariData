import type { PoolClient } from "pg";
import { COLUMN_MAP, QUARANTINE_CHECKS } from "./schema.js";

const SAMPLE_ERRORS_PER_COLUMN = 500;

// Move staging -> persons in one set-based statement. Guarded cast helpers (maridata_to_*)
// turn dirty values into NULL rather than aborting. Returns the number of rows inserted.
export async function transformStagingToPersons(
  client: PoolClient,
  mode: "insert" | "upsert"
): Promise<number> {
  const targets = COLUMN_MAP.map((c) => c.target);
  const exprs = COLUMN_MAP.map((c) => c.expr);

  let conflict: string;
  if (mode === "upsert") {
    const updates = targets
      .filter((t) => t !== "external_id")
      .map((t) => `${t} = EXCLUDED.${t}`)
      .join(", ");
    conflict = `ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET ${updates}`;
  } else {
    conflict = "ON CONFLICT DO NOTHING";
  }

  const sql = `
    INSERT INTO persons (${targets.join(", ")})
    SELECT ${exprs.join(", ")}
    FROM persons_staging
    ${conflict}
  `;

  const res = await client.query(sql);
  return res.rowCount ?? 0;
}

// Detect rows whose cast-sensitive values failed (raw is non-empty but the guarded cast
// yields NULL) and record a capped sample per column in import_errors. Returns the total
// number of distinct staging rows with at least one bad value.
export async function quarantineBadRows(
  client: PoolClient,
  jobId: number
): Promise<number> {
  for (const chk of QUARANTINE_CHECKS) {
    await client.query(
      `INSERT INTO import_errors (job_id, external_id, column_name, raw_value)
       SELECT $1, NULLIF(btrim(src_id), ''), $2, ${chk.staging}
       FROM persons_staging
       WHERE NULLIF(btrim(${chk.staging}), '') IS NOT NULL
         AND ${chk.cast} IS NULL
       LIMIT $3`,
      [jobId, chk.column, SAMPLE_ERRORS_PER_COLUMN]
    );
  }

  const orClauses = QUARANTINE_CHECKS.map(
    (chk) => `(NULLIF(btrim(${chk.staging}), '') IS NOT NULL AND ${chk.cast} IS NULL)`
  ).join(" OR ");

  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM persons_staging WHERE ${orClauses}`
  );
  return Number(rows[0]?.n ?? 0);
}

export async function truncateStaging(client: PoolClient): Promise<void> {
  await client.query("TRUNCATE persons_staging");
}

export async function countStaging(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM persons_staging"
  );
  return Number(rows[0]?.n ?? 0);
}

export async function personsIsEmpty(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ empty: boolean }>(
    "SELECT NOT EXISTS(SELECT 1 FROM persons LIMIT 1) AS empty"
  );
  return rows[0]?.empty ?? true;
}
