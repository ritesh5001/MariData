import type pg from "pg";
import { pool } from "../db/pool.js";

// Keyset (seek) pagination over persons. WHERE id > $cursor ORDER BY id LIMIT n — no
// OFFSET, ever: OFFSET k scans and discards k rows, which dies at 80M-row scale.
// Column lists come from in-code constants (never user input), so interpolating them is
// safe; all user-supplied values ride in $n parameters.

// A keyset boundary. For id-only sorts only `id` is set; when sorting by another column
// `value` carries that column's value at the boundary row (null is meaningful — it marks
// the trailing NULLS LAST block).
export interface KeysetCursor {
  value?: unknown;
  id: number;
}

export interface KeysetPage<T> {
  rows: T[];
  nextCursor: KeysetCursor | null;
}

export interface KeysetOptions {
  columns: readonly string[];
  where?: { clause: string; values: unknown[] };
  // Whitelisted in-code identifier to sort by; undefined or "id" => seek by id only.
  sortColumn?: string;
  cursor?: KeysetCursor;
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

  const col = opts.sortColumn;
  const byColumn = col !== undefined && col !== "id";
  const cmp = opts.dir === "asc" ? ">" : "<";

  let orderBy: string;
  if (!byColumn) {
    // Original fast path: keyset purely on the primary key.
    if (opts.cursor !== undefined) {
      values.push(opts.cursor.id);
      conds.push(`id ${cmp} $${values.length}`);
    }
    orderBy = `id ${opts.dir === "asc" ? "ASC" : "DESC"}`;
  } else {
    // Keyset on (col, id) with NULLS LAST. The id tiebreaker is always ASC so the
    // boundary predicate and ORDER BY agree regardless of the chosen direction.
    if (opts.cursor !== undefined) {
      if (opts.cursor.value === null || opts.cursor.value === undefined) {
        // Boundary sits inside the trailing NULL block; only id advances.
        values.push(opts.cursor.id);
        conds.push(`(${col} IS NULL AND id > $${values.length})`);
      } else {
        values.push(opts.cursor.value);
        const a = values.length;
        values.push(opts.cursor.id);
        const b = values.length;
        // Strictly past cv, OR into the NULL tail, OR tied on cv with a larger id.
        conds.push(
          `(${col} ${cmp} $${a} OR ${col} IS NULL OR (${col} = $${a} AND id > $${b}))`
        );
      }
    }
    orderBy = `${col} ${opts.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, id ASC`;
  }

  const whereSql = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  values.push(opts.limit + 1);
  const sql = `
    SELECT ${opts.columns.join(", ")}
    FROM persons
    ${whereSql}
    ORDER BY ${orderBy}
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
    let nextCursor: KeysetCursor | null = null;
    if (hasMore && rows.length > 0) {
      const last = rows[rows.length - 1]! as T & Record<string, unknown>;
      nextCursor = byColumn ? { value: last[col] ?? null, id: last.id } : { id: last.id };
    }
    return { rows, nextCursor };
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
