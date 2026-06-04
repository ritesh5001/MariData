import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

// Minimal forward-only migration runner. Applies src/migrations/*.sql in filename order,
// each in its own transaction, and records applied files in _migrations so re-runs are
// idempotent. No down-migrations by design (schema changes are additive SQL files).

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM _migrations"
  );
  return new Set(rows.map((r) => r.filename));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const done = await appliedSet();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      // eslint-disable-next-line no-console
      console.log(`applied ${file}`);
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      // eslint-disable-next-line no-console
      console.error(`failed ${file}:`, (err as Error).message);
      throw err;
    } finally {
      client.release();
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    appliedCount === 0
      ? "migrations up to date"
      : `done — applied ${appliedCount} migration(s)`
  );
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    await pool.end();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
