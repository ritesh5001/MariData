import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { listJobs } from "../ingest/jobTracker.js";

export const statsRouter = Router();

// Dashboard stats. Everything here must be instant at 80M rows: reltuples for the count,
// pg_total_relation_size for disk, and small sampled GROUP BYs for the top facets.
const TOP_SAMPLE = 50_000;

async function topValues(column: string): Promise<{ value: string; count: number }[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 5000");
    const { rows } = await client.query<{ value: string; count: number }>(
      `SELECT v AS value, count(*)::bigint AS count
       FROM (SELECT ${column} AS v FROM persons LIMIT ${TOP_SAMPLE}) t
       WHERE v IS NOT NULL
       GROUP BY v ORDER BY count DESC LIMIT 8`
    );
    await client.query("COMMIT");
    return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return [];
  } finally {
    client.release();
  }
}

statsRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [estimate, size, countries, titles, jobs, segments] = await Promise.all([
      pool.query<{ n: number }>(
        "SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'persons'"
      ),
      pool.query<{ total: string; table: string; indexes: string }>(
        `SELECT pg_size_pretty(pg_total_relation_size('persons')) AS total,
                pg_size_pretty(pg_relation_size('persons')) AS table,
                pg_size_pretty(pg_indexes_size('persons')) AS indexes`
      ),
      topValues("location_country"),
      topValues("primary_title_faceting"),
      listJobs(5),
      pool.query<{ n: number }>("SELECT count(*)::bigint AS n FROM segments"),
    ]);

    res.json({
      totalRows: Math.max(0, Number(estimate.rows[0]?.n ?? 0)),
      disk: size.rows[0],
      topCountries: countries,
      topTitles: titles,
      recentImports: jobs,
      segmentCount: Number(segments.rows[0]?.n ?? 0),
      sampleSize: TOP_SAMPLE,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
