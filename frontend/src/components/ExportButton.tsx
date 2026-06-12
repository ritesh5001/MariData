import { useState } from "react";
import { API_BASE } from "../api/client";
import type { SearchMode } from "../api/persons";

// Streams the current result set (filter + search + visible columns) as a file download.
// Plain navigation so the browser handles the stream; the auth cookie rides along
// (SameSite=lax allows top-level GET).
export default function ExportButton({
  filterJson,
  q,
  mode,
  visibleColumns,
}: {
  filterJson: string | null;
  q: string;
  mode: SearchMode;
  visibleColumns: string[];
}) {
  const [open, setOpen] = useState(false);

  function url(format: "csv" | "tsv"): string {
    const params = new URLSearchParams({ format });
    if (filterJson) params.set("filter", filterJson);
    if (q) {
      params.set("q", q);
      params.set("mode", mode);
    }
    if (visibleColumns.length > 0) params.set("columns", visibleColumns.join(","));
    return `${API_BASE}/api/export?${params}`;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        Export
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {(["csv", "tsv"] as const).map((f) => (
            <a
              key={f}
              href={url(f)}
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Download {f.toUpperCase()}
            </a>
          ))}
          <p className="px-3 py-1 text-[11px] leading-tight text-slate-400">
            Streams the current filter and visible columns.
          </p>
        </div>
      )}
    </div>
  );
}
