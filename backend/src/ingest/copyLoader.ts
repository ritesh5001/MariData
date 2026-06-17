import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { CountingStream } from "./progress.js";
import { NormalizeTsvStream } from "./normalizeStream.js";
import { STAGING_COLUMNS } from "./schema.js";

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
): Promise<{ malformedSkipped: number }> {
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

  // Repair dirty rows (stray tabs / embedded newlines / short rows) BEFORE COPY so a handful
  // of bad lines can't abort the whole load. Sits after the byte counter so progress is
  // measured against the real input size. Skipped (over-column) rows are reported via warn.
  const normalizer = new NormalizeTsvStream({
    expectedFields: STAGING_COLUMNS.length,
    onSkip: ({ line, fields, sample }) =>
      console.warn(
        `[import] skipped malformed row at source line ${line}: ${fields} columns ` +
          `(expected ${STAGING_COLUMNS.length}) — ${sample}`
      ),
  });

  armIdle();
  try {
    await pipeline(source, counter, normalizer, copyStream);
    return { malformedSkipped: normalizer.skipped };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
