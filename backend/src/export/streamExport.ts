import type { Response } from "express";
import Cursor from "pg-cursor";
import { pool } from "../db/pool.js";

// Streaming export: a server-side cursor reads the filtered set in batches and writes
// CSV/TSV chunks straight to the HTTP response. Only one batch is ever in memory; an
// 80M-row export never buffers. No statement_timeout — exports are allowed to run long.

const BATCH_ROWS = 5000;

export interface ExportOptions {
  columns: readonly string[]; // already whitelisted by the route
  where?: { clause: string; values: unknown[] };
  format: "csv" | "tsv";
}

function csvEscape(v: unknown, sep: string): string {
  if (v == null) return "";
  let s: string;
  if (Array.isArray(v)) s = v.join("|");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (s.includes('"') || s.includes(sep) || s.includes("\n") || s.includes("\r")) {
    s = `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function streamExport(res: Response, opts: ExportOptions): Promise<void> {
  const sep = opts.format === "csv" ? "," : "\t";
  const whereSql = opts.where ? `WHERE ${opts.where.clause}` : "";
  const sql = `
    SELECT ${opts.columns.join(", ")}
    FROM persons
    ${whereSql}
    ORDER BY id
  `;

  const client = await pool.connect();
  const cursor = client.query(new Cursor(sql, opts.where?.values ?? []));
  let aborted = false;
  res.on("close", () => {
    aborted = true;
  });

  try {
    res.write(opts.columns.join(sep) + "\n");
    for (;;) {
      const rows: Record<string, unknown>[] = await cursor.read(BATCH_ROWS);
      if (rows.length === 0 || aborted) break;
      let chunk = "";
      for (const row of rows) {
        chunk +=
          opts.columns.map((c) => csvEscape(row[c], sep)).join(sep) + "\n";
      }
      // Respect backpressure: wait for drain when the socket buffer is full.
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } finally {
    await cursor.close().catch(() => undefined);
    client.release();
  }
}
