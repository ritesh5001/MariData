import pg from "pg";
import { config } from "../config.js";

// pg returns BIGINT/BIGSERIAL (OID 20) as strings to avoid precision loss. Our ids and
// row counts stay far below 2^53, and string ids break Map-keyed lookups (the SSE
// progress channel) and the API's numeric JSON contract — so parse them as numbers.
pg.types.setTypeParser(20, (v: string) => Number(v));

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
