import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  previewServerPath,
  previewUpload,
  startServerPathImport,
  startUploadImport,
  useImportHistory,
  useImportProgress,
  type ImportJob,
  type ImportOptions,
  type PreviewResult,
} from "../api/imports";

type Source = { kind: "upload"; file: File } | { kind: "path"; serverPath: string };
type Step = "source" | "preview" | "running";

const STAGES = ["staging", "transform", "quarantine", "indexing", "done"] as const;

export default function ImportPage() {
  const [step, setStep] = useState<Step>("source");
  const [sourceKind, setSourceKind] = useState<"upload" | "path">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [serverPath, setServerPath] = useState("");
  const [opts, setOpts] = useState<ImportOptions>({
    mode: "insert",
    hasHeader: true,
    quarantine: true,
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  const source: Source | null = useMemo(() => {
    if (sourceKind === "upload") return file ? { kind: "upload", file } : null;
    return serverPath.trim() ? { kind: "path", serverPath: serverPath.trim() } : null;
  }, [sourceKind, file, serverPath]);

  const previewMut = useMutation({
    mutationFn: async (src: Source) =>
      src.kind === "upload"
        ? previewUpload(src.file, opts.hasHeader)
        : previewServerPath(src.serverPath, opts.hasHeader),
    onSuccess: (result) => {
      setPreview(result);
      setStep("preview");
    },
  });

  const startMut = useMutation({
    mutationFn: async (src: Source) =>
      src.kind === "upload"
        ? startUploadImport(src.file, opts)
        : startServerPathImport(src.serverPath, opts),
    onSuccess: ({ jobId: id }) => {
      setJobId(id);
      setStep("running");
    },
  });

  function reset() {
    setStep("source");
    setPreview(null);
    setJobId(null);
    setFile(null);
    previewMut.reset();
    startMut.reset();
  }

  return (
    <div className="max-w-5xl">
      <h1 className="mb-2 text-2xl font-semibold">Import</h1>
      <p className="mb-6 text-sm text-slate-500">
        Stream a TSV into the database. Pick a file, confirm the columns, watch it load.
      </p>

      {step === "source" && (
        <SourceStep
          sourceKind={sourceKind}
          setSourceKind={setSourceKind}
          file={file}
          setFile={setFile}
          serverPath={serverPath}
          setServerPath={setServerPath}
          opts={opts}
          setOpts={setOpts}
          canContinue={source != null && !previewMut.isPending}
          pending={previewMut.isPending}
          error={previewMut.error}
          onContinue={() => source && previewMut.mutate(source)}
        />
      )}

      {step === "preview" && preview && (
        <PreviewStep
          preview={preview}
          sourceLabel={
            source?.kind === "upload" ? source.file.name : (source?.serverPath ?? "")
          }
          opts={opts}
          pending={startMut.isPending}
          error={startMut.error}
          onBack={() => setStep("source")}
          onStart={() => source && startMut.mutate(source)}
        />
      )}

      {step === "running" && jobId != null && (
        <RunningStep jobId={jobId} onReset={reset} />
      )}

      <HistorySection />
    </div>
  );
}

function SourceStep(props: {
  sourceKind: "upload" | "path";
  setSourceKind: (k: "upload" | "path") => void;
  file: File | null;
  setFile: (f: File | null) => void;
  serverPath: string;
  setServerPath: (p: string) => void;
  opts: ImportOptions;
  setOpts: (o: ImportOptions) => void;
  canContinue: boolean;
  pending: boolean;
  error: Error | null;
  onContinue: () => void;
}) {
  const { opts, setOpts } = props;
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${
      active ? "bg-accent/10 font-medium text-accent" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex gap-2">
        <button className={tab(props.sourceKind === "upload")} onClick={() => props.setSourceKind("upload")}>
          Upload file
        </button>
        <button className={tab(props.sourceKind === "path")} onClick={() => props.setSourceKind("path")}>
          Server path
        </button>
      </div>

      {props.sourceKind === "upload" ? (
        <label className="block cursor-pointer rounded-md border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 hover:border-accent hover:text-accent">
          <input
            type="file"
            accept=".tsv,.txt,.csv,text/tab-separated-values"
            className="hidden"
            onChange={(e) => props.setFile(e.target.files?.[0] ?? null)}
          />
          {props.file
            ? `${props.file.name} (${formatBytes(props.file.size)})`
            : "Click to choose a TSV file"}
        </label>
      ) : (
        <div>
          <input
            type="text"
            value={props.serverPath}
            onChange={(e) => props.setServerPath(e.target.value)}
            placeholder="/data/people.tsv (path on the API server — best for very large files)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <p className="mt-2 text-xs text-slate-400">
            The file is read directly on the server, so multi-GB files import without an
            upload.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Mode</span>
          <select
            value={opts.mode}
            onChange={(e) => setOpts({ ...opts, mode: e.target.value as "insert" | "upsert" })}
            className="rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="insert">Insert (skip existing)</option>
            <option value="upsert">Upsert (update existing)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={opts.hasHeader}
            onChange={(e) => setOpts({ ...opts, hasHeader: e.target.checked })}
          />
          First row is a header
        </label>
        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={opts.quarantine}
            onChange={(e) => setOpts({ ...opts, quarantine: e.target.checked })}
          />
          Quarantine bad values
        </label>
      </div>

      {props.error && <ErrorNote message={props.error.message} />}

      <div className="mt-6">
        <PrimaryButton disabled={!props.canContinue} onClick={props.onContinue}>
          {props.pending ? "Reading preview..." : "Preview columns"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function PreviewStep(props: {
  preview: PreviewResult;
  sourceLabel: string;
  opts: ImportOptions;
  pending: boolean;
  error: Error | null;
  onBack: () => void;
  onStart: () => void;
}) {
  const { preview } = props;
  const ok = preview.headerMatches;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-medium">{props.sourceLabel}</div>
          <div className="text-xs text-slate-500">
            {preview.detectedColumns.length} columns detected /{" "}
            {preview.expectedColumns.length} expected · mode: {props.opts.mode}
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            ok ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {ok ? "Columns match the schema" : "Column mismatch — check the file"}
        </span>
      </div>

      {!preview.columnCountMatches && (
        <ErrorNote
          message={`The file has ${preview.detectedColumns.length} columns but the schema expects ${preview.expectedColumns.length}. Importing will likely fail.`}
        />
      )}

      <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {preview.detectedColumns.map((c, i) => {
                const expected = preview.expectedColumns[i];
                const match = c === expected;
                return (
                  <th
                    key={i}
                    className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 font-medium ${
                      match ? "text-slate-600" : "bg-amber-50 text-amber-700"
                    }`}
                    title={match ? c : `expected: ${expected ?? "(none)"}`}
                  >
                    {c}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.sampleRows.map((row, ri) => (
              <tr key={ri} className="odd:bg-white even:bg-slate-50/50">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="max-w-48 truncate whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-slate-700"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {props.error && <ErrorNote message={props.error.message} />}

      <div className="mt-6 flex gap-3">
        <button
          onClick={props.onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
        <PrimaryButton disabled={props.pending} onClick={props.onStart}>
          {props.pending ? "Starting..." : "Start import"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function RunningStep(props: { jobId: number; onReset: () => void }) {
  const event = useImportProgress(props.jobId);
  const stage = event?.stage ?? "staging";
  const finished = stage === "done";
  const failed = stage === "error";
  const stageIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const percent = finished ? 100 : stage === "staging" ? (event?.percent ?? 0) : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-medium">
          Import #{props.jobId}{" "}
          <span className={failed ? "text-red-600" : finished ? "text-green-600" : "text-slate-500"}>
            — {failed ? "failed" : finished ? "completed" : stage}
          </span>
        </div>
        {(finished || failed) && (
          <button
            onClick={props.onReset}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Import another file
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-2 text-xs">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={`rounded-full px-3 py-1 ${
              failed && i > stageIdx
                ? "bg-slate-100 text-slate-400"
                : i < stageIdx || finished
                  ? "bg-green-100 text-green-700"
                  : i === stageIdx
                    ? "bg-accent/10 font-medium text-accent"
                    : "bg-slate-100 text-slate-400"
            }`}
          >
            {s}
          </span>
        ))}
      </div>

      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            failed ? "bg-red-400" : "bg-accent"
          } ${percent == null && !failed ? "animate-pulse" : ""}`}
          style={{ width: `${percent ?? 100}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {failed
          ? (event?.message ?? "import failed")
          : percent != null
            ? `${percent}%${event?.bytesProcessed ? ` · ${formatBytes(event.bytesProcessed)} read` : ""}`
            : `${stage} — running set-based SQL, this can take a while on large loads`}
      </div>

      {(event?.rowsStaged != null || finished) && (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Staged" value={event?.rowsStaged} />
          <Stat label="Inserted" value={event?.rowsInserted} />
          <Stat label="Conflicted" value={event?.rowsConflicted} />
          <Stat label="Errored" value={event?.rowsErrored} />
        </dl>
      )}
    </div>
  );
}

function HistorySection() {
  const history = useImportHistory();
  const jobs = history.data?.jobs ?? [];

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Import history</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400">No imports yet.</p>
      ) : (
        <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Staged</th>
                <th className="px-4 py-2 text-right font-medium">Inserted</th>
                <th className="px-4 py-2 text-right font-medium">Conflicted</th>
                <th className="px-4 py-2 text-right font-medium">Errored</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-500">{j.id}</td>
                  <td className="max-w-56 truncate px-4 py-2" title={j.filename ?? ""}>
                    {j.filename ?? "—"}
                  </td>
                  <td className="px-4 py-2">{j.mode}</td>
                  <td className="px-4 py-2">
                    <StatusBadge job={j} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(j.rows_staged)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(j.rows_inserted)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(j.rows_conflicted)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(j.rows_errored)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                    {new Date(j.started_at).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                    {duration(j)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ job }: { job: ImportJob }) {
  const cls =
    job.status === "completed"
      ? "bg-green-100 text-green-700"
      : job.status === "failed"
        ? "bg-red-100 text-red-700"
        : "bg-accent/10 text-accent";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
      title={job.error_message ?? undefined}
    >
      {job.status === "running" ? (job.stage ?? "running") : job.status}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value != null ? fmt(value) : "—"}</dd>
    </div>
  );
}

function PrimaryButton(props: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
  );
}

const fmt = (n: number) => n.toLocaleString();

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function duration(j: ImportJob): string {
  if (!j.finished_at) return "—";
  const ms = new Date(j.finished_at).getTime() - new Date(j.started_at).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
