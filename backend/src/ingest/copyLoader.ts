import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { CountingStream } from "./progress.js";

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
  }
): Promise<void> {
  const headerClause = opts.hasHeader ? ", HEADER true" : "";
  const copyStream = client.query(
    copyFrom(
      `COPY persons_staging FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', QUOTE E'\\b', ESCAPE E'\\b'${headerClause})`
    )
  );

  const counter = new CountingStream(opts.totalBytes, opts.onProgress);
  await pipeline(source, counter, copyStream);
}
