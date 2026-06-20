import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { buildListWhere } from "./persons.js";
import { FilterError } from "../search/filterConfigToWhereClause.js";

export const facetsRouter = Router();

// Facet definitions: result-key -> SQL source expression. In-code constants only.
// person_functions is TEXT[]; it unnests AFTER the sample so the row cap stays honest.
const SCALAR_FACETS = {
  location_country: "location_country",
  person_seniority: "person_seniority",
  person_email_status: "person_email_status",
} as const;

// Counting facets over 80M rows would scan everything, so each facet counts within a
// bounded sample of the filtered set, under a statement_timeout. Sampled counts are
// approximate by design; the UI labels them.
const SAMPLE_CAP = 50_000;
const VALUES_PER_FACET = 15;

export interface FacetBucket {
  value: string;
  count: number;
}

const facetsSchema = z.object({
  filter: z.string().max(20_000).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["fts", "fuzzy"]).default("fts"),
});

async function facetQuery(
  innerSelect: string,
  outerFrom: string,
  values: unknown[]
): Promise<FacetBucket[] | "timeout"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 5000");
    const { rows } = await client.query<{ value: string; count: number }>(
      `SELECT v AS value, count(*)::bigint AS count
       FROM (${innerSelect} LIMIT ${SAMPLE_CAP}) sample ${outerFrom}
       WHERE v IS NOT NULL
       GROUP BY v
       ORDER BY count DESC
       LIMIT ${VALUES_PER_FACET}`,
      values
    );
    await client.query("COMMIT");
    return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string }).code === "57014") return "timeout";
    throw err;
  } finally {
    client.release();
  }
}

// Read-only facet counts. Exported so the public router can reuse it.
export async function facetsHandler(req: Request, res: Response): Promise<void> {
  const parsed = facetsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad facets query" });
    return;
  }

  try {
    const where = buildListWhere(parsed.data.filter, parsed.data.q, parsed.data.mode);
    const whereSql = where ? `WHERE ${where.clause}` : "";
    const values = where?.values ?? [];

    const tasks: Promise<[string, FacetBucket[] | "timeout"]>[] = [];
    for (const [key, col] of Object.entries(SCALAR_FACETS)) {
      tasks.push(
        facetQuery(`SELECT ${col} AS v FROM persons ${whereSql}`, "", values).then(
          (r) => [key, r]
        )
      );
    }
    tasks.push(
      facetQuery(
        `SELECT person_functions AS arr FROM persons ${whereSql}`,
        ", LATERAL unnest(sample.arr) AS v",
        values
      ).then((r) => ["person_functions", r])
    );

    const results = await Promise.all(tasks);
    const facets: Record<string, FacetBucket[] | "timeout"> = {};
    for (const [key, buckets] of results) facets[key] = buckets;
    res.json({ facets, sampleCap: SAMPLE_CAP });
  } catch (err) {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
}
facetsRouter.get("/facets", facetsHandler);
