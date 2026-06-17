import type { Readable } from "node:stream";
import { pool } from "../db/pool.js";
import { copyIntoStaging } from "./copyLoader.js";
import {
  transformStagingToPersons,
  quarantineBadRows,
  truncateStaging,
  countStaging,
  personsIsEmpty,
  recordSkippedRows,
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

    const { malformedSkipped, skippedRows } = await copyIntoStaging(
      client,
      opts.openSource(),
      {
        totalBytes: opts.totalBytes,
        hasHeader: opts.hasHeader,
        onProgress: (bytes, percent) =>
          emitProgress({
            jobId: job.id,
            stage: "staging",
            bytesProcessed: bytes,
            percent,
          }),
      }
    );
    // Record the dropped rows (with their reasons) so the user can see exactly which lines
    // were malformed and why — not just a count.
    if (skippedRows.length > 0) {
      await recordSkippedRows(client, job.id, skippedRows);
    }

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

    // Non-fatal warning: some rows in the file were too malformed to load and were skipped.
    // Spell out how many and why, and point at the first few offending source lines.
    let skippedNote: string | undefined;
    if (malformedSkipped > 0) {
      const lines = skippedRows.map((r) => r.line);
      const shown = lines.slice(0, 10).join(", ");
      const more = malformedSkipped > lines.length || lines.length > 10;
      skippedNote =
        `Imported successfully, but ${malformedSkipped} row(s) were skipped because they were ` +
        `malformed (wrong number of columns — usually a stray tab or a line break inside a value). ` +
        `Offending source line(s): ${shown}${more ? ", …" : ""}.`;
    }

    await completeJob(
      job.id,
      { rowsStaged, rowsInserted, rowsConflicted, rowsErrored },
      skippedNote
    );
    emitProgress({
      jobId: job.id,
      stage: "done",
      percent: 100,
      rowsStaged,
      rowsInserted,
      rowsConflicted,
      rowsErrored,
      rowsSkipped: malformedSkipped,
      message: skippedNote,
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
