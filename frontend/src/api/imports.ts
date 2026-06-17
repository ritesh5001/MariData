import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "./client";

export interface ImportJob {
  id: number;
  filename: string | null;
  mode: string;
  status: string;
  stage: string | null;
  rows_staged: number;
  rows_inserted: number;
  rows_conflicted: number;
  rows_errored: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PreviewResult {
  detectedColumns: string[];
  expectedColumns: string[];
  columnCountMatches: boolean;
  headerMatches: boolean;
  sampleRows: string[][];
}

export interface ProgressEvent {
  jobId: number;
  stage: "staging" | "transform" | "quarantine" | "indexing" | "done" | "error";
  percent?: number;
  bytesProcessed?: number;
  rowsStaged?: number;
  rowsInserted?: number;
  rowsConflicted?: number;
  rowsErrored?: number;
  rowsSkipped?: number;
  message?: string;
}

export interface ImportOptions {
  mode: "insert" | "upsert";
  hasHeader: boolean;
  quarantine: boolean;
}

export function previewServerPath(
  serverPath: string,
  hasHeader: boolean
): Promise<PreviewResult> {
  return api<PreviewResult>("/api/import/preview", {
    method: "POST",
    body: JSON.stringify({ serverPath, hasHeader }),
  });
}

// Preview a browser-side File: read just the head of the file, trim the trailing
// (possibly partial) line, and let the server compare it against the expected schema.
export async function previewUpload(
  file: File,
  hasHeader: boolean
): Promise<PreviewResult> {
  const head = await file.slice(0, 256 * 1024).text();
  const lines = head.split("\n");
  if (lines.length > 1) lines.pop();
  return api<PreviewResult>("/api/import/preview", {
    method: "POST",
    body: JSON.stringify({ sampleText: lines.join("\n"), hasHeader }),
  });
}

export function startServerPathImport(
  serverPath: string,
  opts: ImportOptions
): Promise<{ jobId: number }> {
  return api<{ jobId: number }>("/api/import", {
    method: "POST",
    body: JSON.stringify({ serverPath, ...opts }),
  });
}

// Multipart upload streams straight into COPY on the server. Raw fetch (not api()) because
// the browser must set the multipart boundary itself.
export async function startUploadImport(
  file: File,
  opts: ImportOptions
): Promise<{ jobId: number }> {
  const form = new FormData();
  form.append("mode", opts.mode);
  form.append("hasHeader", String(opts.hasHeader));
  form.append("quarantine", String(opts.quarantine));
  form.append("file", file);

  const res = await fetch(`${API_BASE}/api/import`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return (await res.json()) as { jobId: number };
}

export function useImportHistory() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ jobs: ImportJob[] }>("/api/imports"),
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === "running") ? 2000 : false,
  });
}

// Subscribe to a job's SSE stream. The server closes the stream after the terminal event;
// we close the EventSource client-side too so it does not auto-reconnect forever.
export function useImportProgress(jobId: number | null): ProgressEvent | null {
  const [event, setEvent] = useState<ProgressEvent | null>(null);
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setEvent(null);
    if (jobId == null) return;

    const es = new EventSource(`${API_BASE}/api/import/${jobId}/stream`, {
      withCredentials: true,
    });
    esRef.current = es;

    es.onmessage = (e: MessageEvent<string>) => {
      const ev = JSON.parse(e.data) as ProgressEvent;
      setEvent(ev);
      if (ev.stage === "done" || ev.stage === "error") {
        es.close();
        void qc.invalidateQueries({ queryKey: ["imports"] });
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, qc]);

  return event;
}
