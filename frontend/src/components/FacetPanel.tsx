import { useFacets } from "../api/facets";
import type { SearchMode } from "../api/persons";

const FACET_LABELS: Record<string, { label: string; field: string; operator: string }> = {
  location_country: { label: "Country", field: "location_country", operator: "equals" },
  person_seniority: { label: "Seniority", field: "person_seniority", operator: "equals" },
  person_email_status: {
    label: "Email status",
    field: "person_email_status",
    operator: "equals",
  },
  person_functions: {
    label: "Function",
    field: "person_functions",
    operator: "array_contains",
  },
};

export default function FacetPanel({
  filterJson,
  q,
  mode,
  onAddCondition,
}: {
  filterJson: string | null;
  q: string;
  mode: SearchMode;
  onAddCondition: (field: string, operator: string, value: string) => void;
}) {
  const { data, isLoading, isError } = useFacets(filterJson, q, mode);

  return (
    <aside className="w-60 shrink-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold">Facets</h2>
      <p className="mb-3 text-xs text-slate-400">
        Counts within the current results (sampled). Click to filter.
      </p>
      {isLoading && <p className="text-xs text-slate-400">Loading...</p>}
      {isError && <p className="text-xs text-red-600">Facets unavailable.</p>}
      {data &&
        Object.entries(data.facets).map(([key, buckets]) => {
          const meta = FACET_LABELS[key];
          if (!meta) return null;
          return (
            <section key={key} className="mb-4">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {meta.label}
              </h3>
              {buckets === "timeout" ? (
                <p className="text-xs text-slate-400">timed out</p>
              ) : buckets.length === 0 ? (
                <p className="text-xs text-slate-300">no values</p>
              ) : (
                <ul className="space-y-0.5">
                  {buckets.map((b) => (
                    <li key={b.value}>
                      <button
                        onClick={() => onAddCondition(meta.field, meta.operator, b.value)}
                        className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-slate-600 hover:bg-accent/5 hover:text-accent"
                        title={`Filter: ${meta.label} = ${b.value}`}
                      >
                        <span className="truncate">{b.value}</span>
                        <span className="tabular-nums text-slate-400">
                          {b.count.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </aside>
  );
}
