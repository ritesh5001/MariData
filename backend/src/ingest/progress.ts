import { EventEmitter } from "node:events";
import { Transform, type TransformCallback } from "node:stream";

// Live import progress is published in-process (single-process internal tool, so no Redis
// pub/sub needed). Each job gets a channel; the SSE route subscribes. The last event is
// retained so a late subscriber immediately sees current state.

export interface ProgressEvent {
  jobId: number;
  stage: "staging" | "transform" | "quarantine" | "indexing" | "done" | "error";
  percent?: number; // 0..100, only meaningful during staging when total size is known
  bytesProcessed?: number;
  rowsStaged?: number;
  rowsInserted?: number;
  rowsConflicted?: number;
  rowsErrored?: number;
  rowsSkipped?: number; // rows dropped before load because they were malformed
  message?: string;
}

interface Channel {
  emitter: EventEmitter;
  last: ProgressEvent | null;
}

const channels = new Map<number, Channel>();

function channel(jobId: number): Channel {
  let ch = channels.get(jobId);
  if (!ch) {
    ch = { emitter: new EventEmitter(), last: null };
    ch.emitter.setMaxListeners(0);
    channels.set(jobId, ch);
  }
  return ch;
}

export function emitProgress(ev: ProgressEvent): void {
  const ch = channel(ev.jobId);
  ch.last = ev;
  ch.emitter.emit("progress", ev);
}

export function subscribe(jobId: number, cb: (ev: ProgressEvent) => void): () => void {
  const ch = channel(jobId);
  if (ch.last) cb(ch.last);
  ch.emitter.on("progress", cb);
  return () => ch.emitter.off("progress", cb);
}

export function lastEvent(jobId: number): ProgressEvent | null {
  return channels.get(jobId)?.last ?? null;
}

// Drop a channel a short while after the job ends so memory does not grow unbounded.
export function closeChannel(jobId: number): void {
  setTimeout(() => channels.delete(jobId), 30_000);
}

// Pass-through stream that counts bytes (and reports throttled progress) as the TSV flows
// into COPY. Backpressure is preserved — it only forwards what the destination accepts.
export class CountingStream extends Transform {
  private bytes = 0;
  private lastEmit = 0;

  constructor(
    private readonly totalBytes: number | undefined,
    private readonly onProgress: (bytes: number, percent?: number) => void
  ) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    const now = Date.now();
    if (now - this.lastEmit > 200) {
      this.lastEmit = now;
      const percent =
        this.totalBytes && this.totalBytes > 0
          ? Math.min(99, Math.floor((this.bytes / this.totalBytes) * 100))
          : undefined;
      this.onProgress(this.bytes, percent);
    }
    cb(null, chunk);
  }
}
