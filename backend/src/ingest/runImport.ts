import type { Readable } from "node:stream";
import { pool } from "../db/pool.js";
import { copyIntoStaging } from "./copyLoader.js";
import {
  transformStagingToPersons,
  quarantineBadRows,
  truncateStaging,
  countStaging,
  personsIsEmpty,
} from "./transform.js";
import { buildIndexesAndAnalyze } from "./indexAfterLoad.js";
import {
  completeJob,
  failJob,
  setStage,
  type ImportJob,
} from "./jobTracker.js";
import { emitProgress, closeChannel } from "./progress.js";
import { explainImportError } from "./importError.js";

export interface RunImportOptions {
  job: ImportJob;
  // A factory so the source stream is created at consume time.
  openSource: () => Readable;
  totalBytes?: number;
  hasHeader: boolean;
  mode: "insert" | "upsert";
  quarantine: boolean;
}

// Full pipeline: truncate staging -> streaming COPY -> set-based transform -> quarantine ->
// index-after-load + ANALYZE -> finalize. Runs on a dedicated client so it never starves
// the request pool. Designed to be invoked WITHOUT await from the route (fire-and-forget),
// with progress surfaced over the SSE bus and the persisted import_jobs row.
export async function runImport(opts: RunImportOptions): Promise<void> {
  const { job } = opts;
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    // Load-only session tuning. synchronous_commit=off trades a tiny crash-durability
    // window for throughput; maintenance_work_mem speeds CREATE INDEX afterwards.
    await client.query("SET synchronous_commit = off");
    await client.query("SET maintenance_work_mem = '512MB'");

    // staging
    emitProgress({ jobId: job.id, stage: "staging", percent: 0 });
    await truncateStaging(client);
    const wasEmpty = await personsIsEmpty(client);

    const { malformedSkipped } = await copyIntoStaging(client, opts.openSource(), {
      totalBytes: opts.totalBytes,
      hasHeader: opts.hasHeader,
      onProgress: (bytes, percent) =>
        emitProgress({
          jobId: job.id,
          stage: "staging",
          bytesProcessed: bytes,
          percent,
        }),
    });

    const rowsStaged = await countStaging(client);
    emitProgress({ jobId: job.id, stage: "staging", percent: 100, rowsStaged });

    // transform
    await setStage(job.id, "transform");
    emitProgress({ jobId: job.id, stage: "transform", rowsStaged });
    const rowsInserted = await transformStagingToPersons(client, opts.mode);
    const rowsConflicted = Math.max(0, rowsStaged - rowsInserted);
    emitProgress({
      jobId: job.id,
      stage: "transform",
      rowsStaged,
      rowsInserted,
      rowsConflicted,
    });

    // quarantine (optional — can be skipped for max speed on very large loads)
    let rowsErrored = 0;
    if (opts.quarantine) {
      await setStage(job.id, "quarantine");
      emitProgress({ jobId: job.id, stage: "quarantine", rowsStaged, rowsInserted });
      rowsErrored = await quarantineBadRows(client, job.id);
    }

    // index-after-load + analyze
    await setStage(job.id, "indexing");
    emitProgress({
      jobId: job.id,
      stage: "indexing",
      rowsStaged,
      rowsInserted,
      rowsConflicted,
      rowsErrored,
      message: wasEmpty ? "building indexes" : "refreshing indexes/stats",
    });
    await buildIndexesAndAnalyze(client);

    await completeJob(job.id, {
      rowsStaged,
      rowsInserted,
      rowsConflicted,
      rowsErrored,
    });
    emitProgress({
      jobId: job.id,
      stage: "done",
      percent: 100,
      rowsStaged,
      rowsInserted,
      rowsConflicted,
      rowsErrored,
      message:
        malformedSkipped > 0
          ? `Done — skipped ${malformedSkipped} malformed row(s) in the file (wrong number of columns; see server log for the line numbers).`
          : undefined,
    });
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    // Translate the raw COPY/transform error into a clear reason for the UI; the original
    // message is kept on `failure` for logs / connection cleanup below.
    const reason = explainImportError(err);
    await failJob(job.id, reason).catch(() => undefined);
    emitProgress({ jobId: job.id, stage: "error", message: reason });
  } finally {
    // Pass the error to release() so a connection left mid-COPY (aborted/stalled upload) is
    // destroyed instead of returned to the pool in an unusable, half-COPY state.
    client.release(failure);
    closeChannel(job.id);
  }
}
