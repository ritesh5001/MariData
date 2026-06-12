import { pool } from "../db/pool.js";

export type Total =
  | { kind: "estimate"; value: number }
  | { kind: "exact"; value: number }
  | { kind: "capped"; value: number }
  | { kind: "timeout"; value: null };

const COUNT_CAP = 10_000;

// Instant approximate grand total from the planner's statistics. Refreshed by ANALYZE
// (which the import pipeline always runs). Never COUNT(*) the whole table.
export async function grandTotalEstimate(): Promise<Total> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'persons'"
  );
  return { kind: "estimate", value: Math.max(0, rows[0]?.n ?? 0) };
}

// Filtered count, guarded twice: a LIMIT cap (counts at most 10,001 rows) and a short
// statement_timeout. Returns capped/timeout markers instead of making the user wait.
export async function cappedCount(
  whereClause: string,
  values: unknown[],
  timeoutMs = 3000
): Promise<Total> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::bigint AS n
       FROM (SELECT 1 FROM persons WHERE ${whereClause} LIMIT ${COUNT_CAP + 1}) t`,
      values
    );
    await client.query("COMMIT");
    const n = rows[0]?.n ?? 0;
    return n > COUNT_CAP
      ? { kind: "capped", value: COUNT_CAP }
      : { kind: "exact", value: n };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string }).code === "57014") {
      return { kind: "timeout", value: null };
    }
    throw err;
  } finally {
    client.release();
  }
}
