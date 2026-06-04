import pg from "pg";
import { config } from "../config.js";

// Single shared pool for the API. Long-running operations (COPY load, streaming export,
// added in later phases) check out a dedicated client via `pool.connect()` so they never
// starve request handlers.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

pool.on("error", (err: Error) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected idle pg client error", err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values as never);
}
