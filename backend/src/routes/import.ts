import fs from "node:fs";
import { Router, type Request, type Response } from "express";
import busboy from "busboy";
import { z } from "zod";
import { previewFile } from "../ingest/preview.js";
import { runImport } from "../ingest/runImport.js";
import { createJob, getJob, listJobs } from "../ingest/jobTracker.js";
import { subscribe, lastEvent } from "../ingest/progress.js";

export const importRouter = Router();

const previewSchema = z.object({
  serverPath: z.string().min(1),
  hasHeader: z.boolean().default(true),
});

importRouter.post("/import/preview", async (req: Request, res: Response) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "serverPath required" });
    return;
  }
  const { serverPath, hasHeader } = parsed.data;
  if (!fs.existsSync(serverPath)) {
    res.status(400).json({ error: "file not found at serverPath" });
    return;
  }
  try {
    const result = await previewFile(serverPath, hasHeader);
    res.json(result);
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

  bb.on("field", (name, val) => {
    fields[name] = val;
  });

  bb.on("file", (_name, fileStream, info) => {
    handled = true;
    const mode = fields.mode === "upsert" ? "upsert" : "insert";
    const hasHeader = fields.hasHeader !== "false";
    const quarantine = fields.quarantine !== "false";
    const totalBytes = Number(req.headers["content-length"]) || undefined;

    void createJob(info.filename ?? "upload.tsv", mode).then((job) => {
      void runImport({
        job,
        openSource: () => fileStream,
        totalBytes,
        hasHeader,
        mode,
        quarantine,
      });
      res.status(202).json({ jobId: job.id });
    });
  });

  bb.on("close", () => {
    if (!handled && !res.headersSent) {
      res.status(400).json({ error: "no file part in upload" });
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
