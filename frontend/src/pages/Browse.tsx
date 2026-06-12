import { useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  usePersonsInfinite,
  formatTotal,
  type PersonRow,
  type SearchMode,
} from "../api/persons";
import PersonDrawer from "../components/PersonDrawer";

const col = createColumnHelper<PersonRow>();

const text = (v: unknown) => (v == null || v === "" ? "—" : String(v));

const COLUMNS = [
  col.accessor("id", { header: "ID", size: 70 }),
  col.accessor("person_name", { header: "Name", size: 180, cell: (c) => text(c.getValue()) }),
  col.accessor("person_title", { header: "Title", size: 160, cell: (c) => text(c.getValue()) }),
  col.accessor("person_seniority", { header: "Seniority", size: 110, cell: (c) => text(c.getValue()) }),
  col.accessor("organization_name", { header: "Organization", size: 160, cell: (c) => text(c.getValue()) }),
  col.accessor("person_email", { header: "Email", size: 230, cell: (c) => text(c.getValue()) }),
  col.accessor("person_email_status", { header: "Email status", size: 110, cell: (c) => text(c.getValue()) }),
  col.accessor("person_phone", { header: "Phone", size: 140, cell: (c) => text(c.getValue()) }),
  col.accessor("location_city", { header: "City", size: 130, cell: (c) => text(c.getValue()) }),
  col.accessor("location_state", { header: "State", size: 120, cell: (c) => text(c.getValue()) }),
  col.accessor("location_country", { header: "Country", size: 90, cell: (c) => text(c.getValue()) }),
  col.accessor("num_linkedin_connections", { header: "LinkedIn conns", size: 120, cell: (c) => text(c.getValue()) }),
  col.accessor("job_start_date", {
    header: "Job start",
    size: 110,
    cell: (c) => (c.getValue() ? String(c.getValue()).slice(0, 10) : "—"),
  }),
];

const ROW_HEIGHT = 36;

export default function Browse() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("fts");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColumns, setShowColumns] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Debounce the search box so we do not hit the API per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const query = usePersonsInfinite(q, mode);
  const rows = useMemo(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data]
  );
  const total = query.data?.pages[0]?.total;

  const table = useReactTable({
    data: rows,
    columns: COLUMNS,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Infinite scroll: fetch the next keyset page when the last virtual row comes into view.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (
      last &&
      last.index >= tableRows.length - 20 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [virtualItems, tableRows.length, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Browse</h1>
          <p className="text-sm text-slate-500">
            {total ? `${formatTotal(total)} people` : " "}
            {q && ` matching "${q}"`}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "fts"
              ? "Search names, titles, organizations, emails..."
              : "Fuzzy search names, emails, organizations (typo-tolerant)..."
          }
          className="w-96 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <div className="flex rounded-md border border-slate-300 text-sm">
          {(["fts", "fuzzy"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
                mode === m ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {m === "fts" ? "Search" : "Fuzzy"}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <button
            onClick={() => setShowColumns((s) => !s)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Columns
          </button>
          {showColumns && (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {table.getAllLeafColumns().map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={c.getIsVisible()}
                    onChange={c.getToggleVisibilityHandler()}
                  />
                  {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white"
      >
        <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
          <thead className="sticky top-0 z-10 bg-slate-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-500"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              display: "block",
            }}
          >
            {virtualItems.map((vi) => {
              const row = tableRows[vi.index]!;
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.original.id)}
                  className="absolute left-0 flex w-full cursor-pointer border-b border-slate-100 hover:bg-accent/5"
                  style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="truncate whitespace-nowrap px-3 py-2 text-slate-700"
                      title={String(cell.getValue() ?? "")}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {query.isLoading && (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        )}
        {query.isError && (
          <div className="p-8 text-center text-sm text-red-600">
            {(query.error as Error).message}
          </div>
        )}
        {!query.isLoading && rows.length === 0 && !query.isError && (
          <div className="p-8 text-center text-sm text-slate-400">
            {q ? "No people match this search." : "No data yet — run an import first."}
          </div>
        )}
      </div>

      <div className="mt-2 text-xs text-slate-400">
        {rows.length.toLocaleString()} loaded
        {query.isFetchingNextPage && " — loading more..."}
        {q && mode === "fuzzy" && rows.length >= 100 && " (fuzzy shows the top 100 matches)"}
      </div>

      <PersonDrawer personId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
