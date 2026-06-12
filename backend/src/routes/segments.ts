import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  parseFilterConfig,
  FilterError,
} from "../search/filterConfigToWhereClause.js";

export const segmentsRouter = Router();

export interface Segment {
  id: number;
  name: string;
  filter_config: unknown;
  created_at: string;
}

segmentsRouter.get("/segments", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<Segment>(
      "SELECT id, name, filter_config, created_at FROM segments ORDER BY name"
    );
    res.json({ segments: rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  filterConfig: z.unknown(),
});

segmentsRouter.post("/segments", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "name and filterConfig required" });
    return;
  }
  try {
    // Reject configs the compiler would refuse, so a saved segment always loads cleanly.
    parseFilterConfig(parsed.data.filterConfig);

    const { rows } = await pool.query<Segment>(
      `INSERT INTO segments (name, filter_config)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET filter_config = EXCLUDED.filter_config
       RETURNING id, name, filter_config, created_at`,
      [parsed.data.name, JSON.stringify(parsed.data.filterConfig)]
    );
    res.status(201).json({ segment: rows[0] });
  } catch (err) {
    if (err instanceof FilterError) {
      res.status(400).json({ error: `invalid filterConfig: ${err.message}` });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

segmentsRouter.delete("/segments/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const result = await pool.query("DELETE FROM segments WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
