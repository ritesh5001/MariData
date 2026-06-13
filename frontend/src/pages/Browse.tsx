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
  type SortState,
} from "../api/persons";
import PersonDrawer from "../components/PersonDrawer";
import FilterBuilder from "../components/FilterBuilder";
import FacetPanel from "../components/FacetPanel";
import SegmentBar from "../components/SegmentBar";
import BulkToolbar from "../components/BulkToolbar";
import ExportButton from "../components/ExportButton";
import {
  emptyGroup,
  fromWire,
  toWire,
  type FilterGroup,
  type FilterCondition,
} from "../filters/filterModel";

const col = createColumnHelper<PersonRow>();

// Cell renderers per value kind. Arrays join, JSONB stringifies, dates show the day part.
const fmtText = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const fmtDate = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
const fmtArray = (v: unknown) =>
  Array.isArray(v) && v.length > 0 ? v.join(", ") : "—";
const fmtJson = (v: unknown) =>
  v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v);

type ColKind = "text" | "num" | "date" | "array" | "json";

// Every typed column from the TSV (matches the backend GRID_COLUMNS / COLUMN_MAP order).
// `array` and `json` columns are display-only — the backend rejects sorting on them.
const GRID_FIELDS: { key: string; label: string; size: number; kind: ColKind }[] = [
  { key: "id", label: "ID", size: 70, kind: "num" },
  { key: "person_name", label: "Name", size: 180, kind: "text" },
  { key: "person_first_name", label: "First name", size: 120, kind: "text" },
  { key: "person_last_name", label: "Last name", size: 120, kind: "text" },
  { key: "person_name_downcase", label: "Name (lowercase)", size: 160, kind: "text" },
  { key: "person_title", label: "Title", size: 180, kind: "text" },
  { key: "person_functions", label: "Functions", size: 160, kind: "array" },
  { key: "person_seniority", label: "Seniority", size: 110, kind: "text" },
  { key: "person_email_status", label: "Email status", size: 110, kind: "text" },
  { key: "email_confidence", label: "Email confidence", size: 110, kind: "num" },
  { key: "person_email", label: "Email", size: 230, kind: "text" },
  { key: "person_phone", label: "Phone", size: 140, kind: "text" },
  { key: "person_sanitized_phone", label: "Phone (sanitized)", size: 150, kind: "text" },
  { key: "person_email_analyzed", label: "Email (analyzed)", size: 230, kind: "text" },
  { key: "person_linkedin_url", label: "LinkedIn URL", size: 220, kind: "text" },
  { key: "person_detailed_function", label: "Detailed function", size: 160, kind: "text" },
  { key: "person_title_normalized", label: "Title (normalized)", size: 170, kind: "text" },
  { key: "primary_title_faceting", label: "Title (facet)", size: 160, kind: "text" },
  { key: "organization_name", label: "Organization", size: 180, kind: "text" },
  { key: "current_organization_ids", label: "Organization IDs", size: 160, kind: "array" },
  { key: "location_city", label: "City", size: 130, kind: "text" },
  { key: "location_city_full", label: "City (full)", size: 180, kind: "text" },
  { key: "location_state", label: "State", size: 120, kind: "text" },
  { key: "location_state_full", label: "State (full)", size: 170, kind: "text" },
  { key: "location_country", label: "Country", size: 110, kind: "text" },
  { key: "location_postal_code", label: "Postal code", size: 110, kind: "text" },
  { key: "location_geojson", label: "Geo (JSON)", size: 180, kind: "json" },
  { key: "job_start_date", label: "Job start", size: 110, kind: "date" },
  { key: "modality", label: "Modality", size: 110, kind: "text" },
  { key: "prospected_by_team_ids", label: "Prospected team IDs", size: 160, kind: "array" },
  { key: "excluded_by_team_ids", label: "Excluded team IDs", size: 160, kind: "array" },
  { key: "relevance_boost", label: "Relevance boost", size: 120, kind: "num" },
  { key: "num_linkedin_connections", label: "LinkedIn conns", size: 120, kind: "num" },
  { key: "predictive_scores", label: "Predictive scores", size: 180, kind: "json" },
  { key: "person_vacuumed_at", label: "Vacuumed at", size: 160, kind: "date" },
  { key: "random", label: "Random", size: 100, kind: "num" },
  { key: "source_index", label: "Source index", size: 140, kind: "text" },
  { key: "source_type", label: "Source type", size: 120, kind: "text" },
  { key: "external_id", label: "External ID", size: 200, kind: "text" },
  { key: "source_score", label: "Source score", size: 120, kind: "num" },
  { key: "tags", label: "Tags", size: 140, kind: "array" },
  { key: "created_at", label: "Created at", size: 160, kind: "date" },
];

// Only scalar columns can be sorted (the backend whitelist agrees).
const SORTABLE_KEYS = new Set(
  GRID_FIELDS.filter((f) => f.kind !== "array" && f.kind !== "json").map((f) => f.key)
);

const cellFor = (kind: ColKind) =>
  kind === "date" ? fmtDate : kind === "array" ? fmtArray : kind === "json" ? fmtJson : fmtText;

const COLUMNS = GRID_FIELDS.map((f) =>
  col.accessor((row) => row[f.key], {
    id: f.key,
    header: f.label,
    size: f.size,
    cell: (c) => cellFor(f.kind)(c.getValue()),
  })
);

const ROW_HEIGHT = 36;

export default function Browse() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("fts");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColumns, setShowColumns] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterTree, setFilterTree] = useState<FilterGroup>(emptyGroup());
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: "id", dir: "asc" });

  // Server-side sort: clicking a header sorts ascending, clicking the active header flips
  // direction. Sorting is disabled for fuzzy search (results are ranked by similarity).
  const sortDisabled = mode === "fuzzy" && q !== "";
  function toggleSort(colId: string) {
    if (sortDisabled || !SORTABLE_KEYS.has(colId)) return;
    setSort((s) =>
      s.col === colId
        ? { col: colId, dir: s.dir === "asc" ? "desc" : "asc" }
        : { col: colId, dir: "asc" }
    );
  }

  // Debounce the search box so we do not hit the API per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  // Serialized wire filter; null when the tree has no complete conditions.
  const wireFilter = useMemo(() => toWire(filterTree), [filterTree]);
  const filterJson = useMemo(
    () => (wireFilter ? JSON.stringify(wireFilter) : null),
    [wireFilter]
  );

  function addFacetCondition(field: string, operator: string, value: string) {
    const cond: FilterCondition = { kind: "condition", field, operator, value };
    setFilterTree((t) => ({ ...t, conditions: [...t.conditions, cond] }));
    setShowFilters(true);
  }

  const query = usePersonsInfinite(q, mode, filterJson, sort);
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
  // Total pixel width of the visible columns. The virtualized <tbody> is display:block, so it
  // is detached from the table layout and must be sized explicitly or the rows collapse.
  const totalWidth = table.getTotalSize();
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

        <ExportButton
          filterJson={filterJson}
          q={q}
          mode={mode}
          visibleColumns={table.getVisibleLeafColumns().map((c) => c.id)}
        />
        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            wireFilter
              ? "border-accent bg-accent/10 font-medium text-accent"
              : "border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Filters{wireFilter ? " (active)" : ""}
        </button>
        {wireFilter && (
          <button
            onClick={() => setFilterTree(emptyGroup())}
            className="text-xs text-slate-400 hover:text-red-600"
          >
            clear
          </button>
        )}

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

      {showFilters && (
        <div className="mb-3 space-y-2">
          <SegmentBar
            currentFilter={wireFilter}
            onLoad={(cfg) => {
              setFilterTree(fromWire(cfg));
              setShowFilters(true);
            }}
          />
          <FilterBuilder group={filterTree} onChange={setFilterTree} depth={0} />
          <BulkToolbar wireFilter={wireFilter} total={total} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <FacetPanel
          filterJson={filterJson}
          q={q}
          mode={mode}
          onAddCondition={addFacetCondition}
        />
        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white"
        >
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: totalWidth, minWidth: "100%" }}
        >
          <thead className="sticky top-0 z-10 bg-slate-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const active = sort.col === h.column.id;
                  const sortable = !sortDisabled && SORTABLE_KEYS.has(h.column.id);
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() }}
                      onClick={() => toggleSort(h.column.id)}
                      className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-xs font-medium ${
                        sortable
                          ? "cursor-pointer select-none text-slate-500 hover:bg-slate-100"
                          : "cursor-default text-slate-400"
                      }`}
                      title={
                        sortDisabled
                          ? "Sorting is unavailable for fuzzy search"
                          : sortable
                            ? "Click to sort"
                            : "This column is not sortable"
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sortable && (
                          <span className={active ? "text-accent" : "text-slate-300"}>
                            {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: virtualizer.getTotalSize(),
              width: totalWidth,
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
                      className="shrink-0 truncate whitespace-nowrap px-3 py-2 text-slate-700"
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
            {q || wireFilter
              ? "No people match this search/filter."
              : "No data yet — run an import first."}
          </div>
        )}
        </div>
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
