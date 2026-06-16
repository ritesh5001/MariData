import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { CountingStream } from "./progress.js";

// If no bytes reach COPY for this long, treat the upload as stalled (e.g. a half-open client
// connection) and abort. Without this a stalled stream leaves `COPY ... FROM STDIN` parked
// at ClientRead and the import_jobs row stuck in 'running' indefinitely.
const IDLE_TIMEOUT_MS = 120_000;

// Stream a TSV source straight into persons_staging via COPY FROM STDIN. No row-by-row
// inserts, no full-file buffering — backpressure flows from Postgres back through the
// source stream.
//
// Format note: FORMAT csv with a TAB delimiter and an unlikely QUOTE/ESCAPE byte
// (backspace, 0x08) makes COPY split purely on tabs while preserving the double-quotes and
// backslashes inside JSON columns (geojson, predictive_scores) literally. Empty fields
// become SQL NULL.
export async function copyIntoStaging(
  client: PoolClient,
  source: Readable,
  opts: {
    totalBytes?: number;
    hasHeader: boolean;
    onProgress: (bytes: number, percent?: number) => void;
    idleTimeoutMs?: number;
  }
): Promise<void> {
  const headerClause = opts.hasHeader ? ", HEADER true" : "";
  const copyStream = client.query(
    copyFrom(
      `COPY persons_staging FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', QUOTE E'\\b', ESCAPE E'\\b'${headerClause})`
    )
  );

  // Stall watchdog: rearmed every time bytes flow (CountingStream reports progress as data
  // moves). If it ever fires, the source is destroyed, which rejects the pipeline below and
  // lets the caller fail the job and release the DB connection.
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  let idleTimer: NodeJS.Timeout | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      source.destroy(new Error(`upload stalled: no data received for ${idleMs}ms`));
    }, idleMs);
  };

  const counter = new CountingStream(opts.totalBytes, (bytes, percent) => {
    armIdle();
    opts.onProgress(bytes, percent);
  });

  armIdle();
  try {
    await pipeline(source, counter, copyStream);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
