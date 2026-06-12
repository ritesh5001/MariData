import { usePerson } from "../api/persons";

// Field order/grouping for the detail view. Anything not listed falls into "Other".
const GROUPS: { title: string; fields: string[] }[] = [
  {
    title: "Identity",
    fields: [
      "person_name",
      "person_first_name",
      "person_last_name",
      "person_name_downcase",
    ],
  },
  {
    title: "Role",
    fields: [
      "person_title",
      "person_title_normalized",
      "primary_title_faceting",
      "person_detailed_function",
      "person_functions",
      "person_seniority",
      "job_start_date",
      "modality",
    ],
  },
  {
    title: "Contact",
    fields: [
      "person_email",
      "person_email_status",
      "email_confidence",
      "person_email_analyzed",
      "person_phone",
      "person_sanitized_phone",
      "person_linkedin_url",
      "num_linkedin_connections",
    ],
  },
  {
    title: "Organization",
    fields: ["organization_name", "current_organization_ids"],
  },
  {
    title: "Location",
    fields: [
      "location_city",
      "location_city_full",
      "location_state",
      "location_state_full",
      "location_country",
      "location_postal_code",
      "location_geojson",
    ],
  },
  {
    title: "Scoring & provenance",
    fields: [
      "predictive_scores",
      "relevance_boost",
      "random",
      "prospected_by_team_ids",
      "excluded_by_team_ids",
      "person_vacuumed_at",
      "source_index",
      "source_type",
      "external_id",
      "source_score",
    ],
  },
  { title: "Platform", fields: ["id", "tags", "created_at"] },
];

function FieldValue({ value }: { value: unknown }) {
  if (value == null || value === "") {
    return <span className="text-slate-300">—</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span
            key={i}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
          >
            {String(v)}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === "object") {
    return (
      <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const s = String(value);
  if (/^https?:\/\//.test(s)) {
    return (
      <a href={s} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {s}
      </a>
    );
  }
  return <span className="break-words">{s}</span>;
}

export default function PersonDrawer({
  personId,
  onClose,
}: {
  personId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = usePerson(personId);
  if (personId == null) return null;
  const person = data?.person;

  const grouped = new Set(GROUPS.flatMap((g) => g.fields));
  const other = person
    ? Object.keys(person).filter((k) => !grouped.has(k))
    : [];

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative z-40 flex h-full w-[480px] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {person?.person_name ?? `Person #${personId}`}
            </h2>
            {person?.person_title != null && (
              <p className="text-sm text-slate-500">
                {String(person.person_title)}
                {person.organization_name != null &&
                  ` at ${String(person.organization_name)}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading && <p className="text-sm text-slate-400">Loading...</p>}
          {isError && (
            <p className="text-sm text-red-600">{(error as Error).message}</p>
          )}
          {person && (
            <>
              {GROUPS.map((g) => (
                <section key={g.title} className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {g.title}
                  </h3>
                  <dl className="space-y-2">
                    {g.fields
                      .filter((f) => f in person)
                      .map((f) => (
                        <div key={f} className="grid grid-cols-[180px_1fr] gap-2 text-sm">
                          <dt className="truncate text-slate-500" title={f}>
                            {f}
                          </dt>
                          <dd className="min-w-0 text-slate-800">
                            <FieldValue value={person[f]} />
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              ))}
              {other.length > 0 && (
                <section className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Other
                  </h3>
                  <dl className="space-y-2">
                    {other.map((f) => (
                      <div key={f} className="grid grid-cols-[180px_1fr] gap-2 text-sm">
                        <dt className="truncate text-slate-500" title={f}>
                          {f}
                        </dt>
                        <dd className="min-w-0 text-slate-800">
                          <FieldValue value={person[f]} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
