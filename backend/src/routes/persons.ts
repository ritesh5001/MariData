import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { COLUMN_MAP } from "../ingest/schema.js";
import { keysetPage, rankedPage, type KeysetCursor } from "../search/keyset.js";
import { FILTER_FIELDS } from "../search/filterFields.js";
import { ftsCondition, fuzzyCondition, fuzzyRank } from "../search/textSearch.js";
import { grandTotalEstimate, cappedCount, type Total } from "../search/counts.js";
import {
  parseFilterConfig,
  filterConfigToWhereClause,
  FilterError,
} from "../search/filterConfigToWhereClause.js";
import {
  EDITABLE_FIELDS,
  EditError,
  coerceEditValue,
} from "../persons/editableFields.js";

export const personsRouter = Router();

// Every typed column (the COLUMN_MAP targets) plus platform columns; excludes only the
// bulky generated search_vector. The browse grid and the detail view share this list, so
// every TSV column is available in both. In-code constants — never derived from request input.
const ALL_COLUMNS = [
  "id",
  ...COLUMN_MAP.map((c) => c.target),
  "tags",
  "created_at",
] as const;
const GRID_COLUMNS = ALL_COLUMNS;
const DETAIL_COLUMNS = ALL_COLUMNS;

const FUZZY_RESULT_CAP = 100;

// Columns the grid may sort by: scalar (text/number/date) columns only. Array and JSONB
// columns are shown but not sortable — a keyset seek on them is ill-defined. The whitelist
// is derived from in-code constants, so an identifier here is never user-derived.
const SORTABLE_COLUMNS = new Set<string>(
  GRID_COLUMNS.filter((c) => {
    const t = FILTER_FIELDS[c];
    return t !== undefined && t !== "array";
  })
);

const listSchema = z.object({
  // Opaque base64 keyset cursor (see encode/decodeCursor); never a row offset.
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["fts", "fuzzy"]).default("fts"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  // Column to sort by; defaults to id (the keyset primary key).
  sort: z.string().max(64).optional(),
  // JSON-encoded filterConfig (filters.md); validated/compiled by the filter compiler.
  filter: z.string().max(20_000).optional(),
});

function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): KeysetCursor {
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as {
      value?: unknown;
      id?: unknown;
    };
    if (typeof o.id !== "number" || !Number.isInteger(o.id)) throw new Error("bad id");
    return { value: o.value, id: o.id };
  } catch {
    throw new FilterError("invalid cursor");
  }
}

interface GridRow {
  id: number;
  [key: string]: unknown;
}

// Compile the optional filterConfig and optional search box into one AND-combined,
// fully parameterized WHERE fragment starting at $1.
export function buildListWhere(
  filterJson: string | undefined,
  q: string | undefined,
  mode: "fts" | "fuzzy"
): { clause: string; values: unknown[] } | undefined {
  const parts: string[] = [];
  const values: unknown[] = [];

  if (filterJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(filterJson);
    } catch {
      throw new FilterError("filter is not valid JSON");
    }
    const compiled = filterConfigToWhereClause(parseFilterConfig(parsed), 1);
    parts.push(compiled.text);
    values.push(...compiled.values);
  }

  if (q) {
    const frag =
      mode === "fuzzy"
        ? fuzzyCondition(q, values.length + 1)
        : ftsCondition(q, values.length + 1);
    parts.push(frag.clause);
    values.push(...frag.values);
  }

  if (parts.length === 0) return undefined;
  return { clause: parts.join(" AND "), values };
}

// Read-only list/search handler. Exported so both the cookie-protected admin router
// and the key-protected public router can share one implementation.
export async function listPersonsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad query" });
    return;
  }
  const { cursor, limit, q, mode, dir, sort, filter } = parsed.data;

  if (sort !== undefined && sort !== "id" && !SORTABLE_COLUMNS.has(sort)) {
    res.status(400).json({ error: `cannot sort by: ${sort}` });
    return;
  }

  try {
    const where = buildListWhere(filter, q, mode);

    if (q && mode === "fuzzy" && where) {
      // Ranked by similarity; the rank expression reuses the q parameter (last value).
      // Similarity ranking owns the order, so column sort does not apply here.
      const rows = await rankedPage<GridRow>({
        columns: GRID_COLUMNS,
        where,
        orderBy: fuzzyRank(where.values.length),
        limit: FUZZY_RESULT_CAP,
      });
      const total: Total =
        rows.length < FUZZY_RESULT_CAP
          ? { kind: "exact", value: rows.length }
          : await cappedCount(where.clause, where.values);
      res.json({ rows, nextCursor: null, total });
      return;
    }

    const page = await keysetPage<GridRow>({
      columns: GRID_COLUMNS,
      where,
      sortColumn: sort,
      cursor: cursor ? decodeCursor(cursor) : undefined,
      dir,
      limit,
    });
    // Count once per search (first page); cursor pages reuse the client's cached total.
    let total: Total | undefined;
    if (cursor === undefined) {
      total = where
        ? await cappedCount(where.clause, where.values)
        : await grandTotalEstimate();
    }
    res.json({
      rows: page.rows,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      total,
    });
  } catch (err) {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    // Express 4 does not route async throws to error middleware; answer here.
    if ((err as { code?: string }).code === "57014") {
      res.status(504).json({ error: "query timed out" });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
}
personsRouter.get("/persons", listPersonsHandler);

// Read-only single-record handler. Shared between admin and public routers.
export async function getPersonHandler(
  req: Request,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLUMNS.join(", ")} FROM persons WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ person: rows[0] });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
personsRouter.get("/persons/:id", getPersonHandler);

personsRouter.patch("/persons/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const body = req.body as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({ error: "expected an object of field updates" });
    return;
  }

  try {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, raw] of Object.entries(body)) {
      const type = EDITABLE_FIELDS[field];
      if (!type) throw new EditError(`field not editable: ${field}`);
      values.push(coerceEditValue(field, type, raw));
      sets.push(`${field} = $${values.length}${type === "jsonb" ? "::jsonb" : ""}`);
    }
    if (sets.length === 0) {
      res.status(400).json({ error: "no fields to update" });
      return;
    }
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE persons SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING ${DETAIL_COLUMNS.join(", ")}`,
      values
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ person: rows[0] });
  } catch (err) {
    if (err instanceof EditError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "external_id already exists on another record" });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

personsRouter.delete("/persons/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const result = await pool.query("DELETE FROM persons WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
