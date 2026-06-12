import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { streamExport } from "../export/streamExport.js";
import { buildListWhere } from "./persons.js";
import { COLUMN_MAP } from "../ingest/schema.js";
import { FilterError } from "../search/filterConfigToWhereClause.js";

export const exportRouter = Router();

// Every exportable column (whitelist for the ?columns= selection).
const EXPORTABLE = new Set<string>([
  "id",
  ...COLUMN_MAP.map((c) => c.target),
  "tags",
  "created_at",
]);

const DEFAULT_COLUMNS = [
  "id",
  "person_name",
  "person_title",
  "person_seniority",
  "organization_name",
  "person_email",
  "person_email_status",
  "person_phone",
  "person_linkedin_url",
  "location_city",
  "location_state",
  "location_country",
  "job_start_date",
  "tags",
];

const exportSchema = z.object({
  format: z.enum(["csv", "tsv"]).default("csv"),
  filter: z.string().max(20_000).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["fts", "fuzzy"]).default("fts"),
  columns: z.string().max(2000).optional(),
});

exportRouter.get("/export", async (req: Request, res: Response) => {
  const parsed = exportSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad export query" });
    return;
  }
  const { format, filter, q, mode } = parsed.data;

  let columns = DEFAULT_COLUMNS;
  if (parsed.data.columns) {
    const requested = parsed.data.columns.split(",").map((s) => s.trim());
    const invalid = requested.filter((c) => !EXPORTABLE.has(c));
    if (invalid.length > 0) {
      res.status(400).json({ error: `unknown columns: ${invalid.join(", ")}` });
      return;
    }
    if (requested.length > 0) columns = requested;
  }

  try {
    const where = buildListWhere(filter, q, mode);
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      "Content-Type": format === "csv" ? "text/csv" : "text/tab-separated-values",
      "Content-Disposition": `attachment; filename="maridata-export-${stamp}.${format}"`,
      "Cache-Control": "no-cache",
    });
    await streamExport(res, { columns, where, format });
  } catch (err) {
    if (err instanceof FilterError) {
      if (!res.headersSent) res.status(400).json({ error: err.message });
      return;
    }
    // Headers may already be sent mid-stream; just terminate.
    if (!res.headersSent) {
      res.status(500).json({ error: (err as Error).message });
    } else {
      res.end();
    }
  }
});
