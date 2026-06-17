import fs from "node:fs";
import { PassThrough } from "node:stream";
import { Router, type Request, type Response } from "express";
import busboy from "busboy";
import { z } from "zod";
import { previewFile, previewSample } from "../ingest/preview.js";
import { runImport } from "../ingest/runImport.js";
import { createJob, getJob, listJobs } from "../ingest/jobTracker.js";
import { subscribe, lastEvent } from "../ingest/progress.js";
import { explainImportError } from "../ingest/importError.js";

export const importRouter = Router();

const previewSchema = z.union([
  z.object({
    serverPath: z.string().min(1),
    hasHeader: z.boolean().default(true),
  }),
  z.object({
    // First chunk of a browser upload; capped well above 11 lines of any sane TSV.
    sampleText: z.string().min(1).max(1_000_000),
    hasHeader: z.boolean().default(true),
  }),
]);

importRouter.post("/import/preview", async (req: Request, res: Response) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "serverPath or sampleText required" });
    return;
  }
  const { hasHeader } = parsed.data;
  try {
    if ("sampleText" in parsed.data) {
      res.json(previewSample(parsed.data.sampleText, hasHeader));
      return;
    }
    const { serverPath } = parsed.data;
    if (!fs.existsSync(serverPath)) {
      res.status(400).json({ error: "file not found at serverPath" });
      return;
    }
    res.json(await previewFile(serverPath, hasHeader));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const startSchema = z.object({
  serverPath: z.string().min(1),
  mode: z.enum(["insert", "upsert"]).default("insert"),
  hasHeader: z.boolean().default(true),
  quarantine: z.boolean().default(true),
});

// Start an import. Two content types:
//  - application/json { serverPath, ... }  -> stream the local file (preferred for big files)
//  - multipart/form-data with a `file` part -> stream the upload straight into COPY
importRouter.post("/import", async (req: Request, res: Response) => {
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    await startFromUpload(req, res);
    return;
  }

  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "serverPath required" });
    return;
  }
  const { serverPath, mode, hasHeader, quarantine } = parsed.data;
  if (!fs.existsSync(serverPath)) {
    res.status(400).json({ error: "file not found at serverPath" });
    return;
  }
  const totalBytes = fs.statSync(serverPath).size;
  const job = await createJob(serverPath, mode);

  // Fire-and-forget: progress flows over SSE; the job row holds the persisted result.
  void runImport({
    job,
    openSource: () => fs.createReadStream(serverPath),
    totalBytes,
    hasHeader,
    mode,
    quarantine,
  });

  res.status(202).json({ jobId: job.id });
});

async function startFromUpload(req: Request, res: Response): Promise<void> {
  const bb = busboy({ headers: req.headers });
  const fields: Record<string, string> = {};
  let handled = false;
  let source: PassThrough | null = null;

  bb.on("field", (name, val) => {
    fields[name] = val;
  });

  bb.on("file", (_name, fileStream, info) => {
    handled = true;

    // Attach a consumer to the busboy file part SYNCHRONOUSLY — in the same tick as the
    // event. busboy stalls a file stream that has no reader, and createJob() below is an
    // async DB round-trip (followed by more inside runImport) before the COPY pipeline
    // attaches. Without this immediate pipe the stream sits unread during that gap, so
    // `COPY ... FROM STDIN` hangs at ClientRead forever and persons_staging never gets a
    // row. The PassThrough is a real consumer now and buffers with backpressure until
    // runImport's pipeline drains it.
    const fileSource = new PassThrough();
    source = fileSource;
    fileStream.pipe(fileSource);
    // pipe() does not forward errors; surface a truncated/aborted part to the COPY consumer
    // so the import fails fast instead of stalling.
    fileStream.on("error", (err) => fileSource.destroy(err));

    const mode = fields.mode === "upsert" ? "upsert" : "insert";
    const hasHeader = fields.hasHeader !== "false";
    const quarantine = fields.quarantine !== "false";
    const totalBytes = Number(req.headers["content-length"]) || undefined;

    createJob(info.filename ?? "upload.tsv", mode)
      .then((job) => {
        void runImport({
          job,
          openSource: () => fileSource,
          totalBytes,
          hasHeader,
          mode,
          quarantine,
        });
        res.status(202).json({ jobId: job.id });
      })
      .catch((err: unknown) => {
        fileSource.destroy(err instanceof Error ? err : new Error(String(err)));
        if (!res.headersSent) {
          res.status(500).json({ error: explainImportError(err) });
        }
      });
  });

  bb.on("error", (err: unknown) => {
    source?.destroy(err instanceof Error ? err : new Error(String(err)));
    if (!res.headersSent) {
      res.status(400).json({
        error: `The upload could not be read: ${
          err instanceof Error ? err.message : String(err)
        }. The file may be corrupted or the upload was cut off — try again.`,
      });
    }
  });

  bb.on("close", () => {
    if (!handled && !res.headersSent) {
      res.status(400).json({ error: "no file part in upload" });
    }
  });

  // Client disconnect mid-upload: tear the source down so the COPY pipeline errors out and
  // runImport marks the job failed — instead of the request hanging and the import_jobs row
  // sitting in 'running' forever (which previously needed a manual pg_terminate_backend).
  req.on("close", () => {
    if (!req.readableEnded && source && !source.destroyed) {
      source.destroy(new Error("upload connection closed before completion"));
    }
  });

  req.pipe(bb);
}

importRouter.get("/import/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const job = await getJob(id);
  if (!job) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ job, live: lastEvent(id) });
});

importRouter.get("/imports", async (_req: Request, res: Response) => {
  res.json({ jobs: await listJobs() });
});

// SSE live progress.
importRouter.get("/import/:id/stream", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  // Heartbeat keeps the connection alive through proxies.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  const unsubscribe = subscribe(id, (ev) => {
    send(ev);
    if (ev.stage === "done" || ev.stage === "error") {
      // Let the client read the final frame, then close.
      setTimeout(() => res.end(), 100);
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
