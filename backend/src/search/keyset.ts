import type pg from "pg";
import { pool } from "../db/pool.js";

// Keyset (seek) pagination over persons. WHERE id > $cursor ORDER BY id LIMIT n — no
// OFFSET, ever: OFFSET k scans and discards k rows, which dies at 80M-row scale.
// Column lists come from in-code constants (never user input), so interpolating them is
// safe; all user-supplied values ride in $n parameters.

export interface KeysetPage<T> {
  rows: T[];
  nextCursor: number | null;
}

export interface KeysetOptions {
  columns: readonly string[];
  where?: { clause: string; values: unknown[] };
  cursor?: number;
  dir: "asc" | "desc";
  limit: number;
  timeoutMs?: number;
}

export async function keysetPage<T extends { id: number }>(
  opts: KeysetOptions
): Promise<KeysetPage<T>> {
  const values: unknown[] = [...(opts.where?.values ?? [])];
  const conds: string[] = [];
  if (opts.where) conds.push(opts.where.clause);

  if (opts.cursor !== undefined) {
    values.push(opts.cursor);
    conds.push(`id ${opts.dir === "asc" ? ">" : "<"} $${values.length}`);
  }

  const whereSql = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  values.push(opts.limit + 1);
  const sql = `
    SELECT ${opts.columns.join(", ")}
    FROM persons
    ${whereSql}
    ORDER BY id ${opts.dir === "asc" ? "ASC" : "DESC"}
    LIMIT $${values.length}
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SET LOCAL statement_timeout = ${Math.floor(opts.timeoutMs ?? 5000)}`
    );
    const res = await client.query<T>(sql, values);
    await client.query("COMMIT");

    const hasMore = res.rows.length > opts.limit;
    const rows = hasMore ? res.rows.slice(0, opts.limit) : res.rows;
    return {
      rows,
      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1]!.id : null,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Bounded ranked query (fuzzy search): best matches first, single page, no cursor.
// Ranking by similarity cannot keyset on id, so the result set is hard-capped instead.
export async function rankedPage<T extends pg.QueryResultRow>(opts: {
  columns: readonly string[];
  where: { clause: string; values: unknown[] };
  orderBy: string;
  limit: number;
  timeoutMs?: number;
}): Promise<T[]> {
  const sql = `
    SELECT ${opts.columns.join(", ")}
    FROM persons
    WHERE ${opts.where.clause}
    ORDER BY ${opts.orderBy} DESC
    LIMIT ${Math.floor(opts.limit)}
  `;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SET LOCAL statement_timeout = ${Math.floor(opts.timeoutMs ?? 5000)}`
    );
    const res = await client.query<T>(sql, opts.where.values);
    await client.query("COMMIT");
    return res.rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
