import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexesSql = fs.readFileSync(path.join(here, "indexes.sql"), "utf8");

// Build the heavy search indexes after the bulk load (index-after-load contract). The DDL
// is all IF NOT EXISTS, so calling this when indexes already exist is a cheap no-op — we
// still run it on incremental loads to cover the case where a prior load was interrupted
// before indexing. Always ANALYZE so the planner + reltuples estimate are fresh.
export async function buildIndexesAndAnalyze(client: PoolClient): Promise<void> {
  await client.query(indexesSql);
  await client.query("ANALYZE persons");
}
