import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  parseFilterConfig,
  filterConfigToWhereClause,
  FilterError,
} from "../search/filterConfigToWhereClause.js";

export const bulkRouter = Router();

const BATCH_SIZE = 10_000;

// Target selection: a filterConfig (compiled by the same filterConfigToWhereClause used
// for browsing — no duplicated SQL logic) and/or an explicit id list, ANDed together.
const targetSchema = z.object({
  filterConfig: z.unknown().optional(),
  ids: z.array(z.number().int().positive()).max(10_000).optional(),
});

function buildTargetWhere(input: z.infer<typeof targetSchema>): {
  clause: string;
  values: unknown[];
} {
  const parts: string[] = [];
  const values: unknown[] = [];
  if (input.filterConfig !== undefined) {
    const compiled = filterConfigToWhereClause(parseFilterConfig(input.filterConfig), 1);
    parts.push(compiled.text);
    values.push(...compiled.values);
  }
  if (input.ids && input.ids.length > 0) {
    values.push(input.ids);
    parts.push(`id = ANY($${values.length})`);
  }
  if (parts.length === 0) {
    throw new FilterError("a filterConfig or ids list is required");
  }
  return { clause: parts.join(" AND "), values };
}

// Set-based batched mutation. Each round selects one keyset batch of target ids and
// mutates it in a single statement — never row-by-row; bounded memory and lock footprint.
// Parameter layout: [...where.values, cursor, batchSize, ...extraValues].
async function runBatched(
  where: { clause: string; values: unknown[] },
  extraValues: unknown[],
  buildSql: (opts: {
    clause: string;
    cursorP: string;
    limitP: string;
    extraP: string[];
  }) => string
): Promise<number> {
  const n = where.values.length;
  const sql = buildSql({
    clause: where.clause,
    cursorP: `$${n + 1}`,
    limitP: `$${n + 2}`,
    extraP: extraValues.map((_, i) => `$${n + 3 + i}`),
  });

  let affected = 0;
  let cursor = 0;
  const client = await pool.connect();
  try {
    for (;;) {
      const res = await client.query<{ id: number }>(sql, [
        ...where.values,
        cursor,
        BATCH_SIZE,
        ...extraValues,
      ]);
      if (res.rows.length === 0) break;
      affected += res.rows.length;
      cursor = Math.max(...res.rows.map((r) => Number(r.id)));
      if (res.rows.length < BATCH_SIZE) break;
    }
    return affected;
  } finally {
    client.release();
  }
}

const tagSchema = targetSchema.extend({
  tag: z.string().trim().min(1).max(50),
  action: z.enum(["add", "remove"]).default("add"),
});

bulkRouter.post("/bulk/tag", async (req: Request, res: Response) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "tag (and filterConfig or ids) required" });
    return;
  }
  try {
    const where = buildTargetWhere(parsed.data);
    const affected = await runBatched(
      where,
      [parsed.data.tag],
      ({ clause, cursorP, limitP, extraP }) => {
        const tagP = extraP[0]!;
        const setExpr =
          parsed.data.action === "add"
            ? `tags = CASE WHEN p.tags IS NULL THEN ARRAY[${tagP}]
                          WHEN NOT (p.tags @> ARRAY[${tagP}]) THEN p.tags || ${tagP}
                          ELSE p.tags END`
            : `tags = NULLIF(array_remove(coalesce(p.tags, '{}'), ${tagP}), '{}')`;
        return `
          WITH batch AS (
            SELECT id FROM persons
            WHERE (${clause}) AND id > ${cursorP}
            ORDER BY id LIMIT ${limitP}
          )
          UPDATE persons p SET ${setExpr}
          FROM batch WHERE p.id = batch.id
          RETURNING p.id`;
      }
    );
    res.json({ affected });
  } catch (err) {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

const deleteSchema = targetSchema.extend({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "bulk delete requires confirm: true" }),
  }),
});

bulkRouter.post("/bulk/delete", async (req: Request, res: Response) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "confirm: true required",
    });
    return;
  }
  try {
    const where = buildTargetWhere(parsed.data);
    const affected = await runBatched(where, [], ({ clause, cursorP, limitP }) => `
      WITH batch AS (
        SELECT id FROM persons
        WHERE (${clause}) AND id > ${cursorP}
        ORDER BY id LIMIT ${limitP}
      )
      DELETE FROM persons p USING batch WHERE p.id = batch.id
      RETURNING p.id`);
    res.json({ affected });
  } catch (err) {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});
