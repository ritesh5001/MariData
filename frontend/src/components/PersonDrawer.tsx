import { useState } from "react";
import { usePerson } from "../api/persons";
import { useUpdatePerson, useDeletePerson } from "../api/crud";

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

// Mirrors the backend PATCH whitelist (minus JSONB, which stays read-only in the UI).
const EDITABLE: Record<string, "text" | "number" | "date" | "array"> = {
  person_name: "text",
  person_first_name: "text",
  person_last_name: "text",
  person_name_downcase: "text",
  person_title: "text",
  person_functions: "array",
  person_seniority: "text",
  person_email_status: "text",
  email_confidence: "number",
  person_email: "text",
  person_phone: "text",
  person_sanitized_phone: "text",
  person_email_analyzed: "text",
  person_linkedin_url: "text",
  person_detailed_function: "text",
  person_title_normalized: "text",
  primary_title_faceting: "text",
  organization_name: "text",
  current_organization_ids: "array",
  location_city: "text",
  location_city_full: "text",
  location_state: "text",
  location_state_full: "text",
  location_country: "text",
  location_postal_code: "text",
  job_start_date: "date",
  modality: "text",
  prospected_by_team_ids: "array",
  excluded_by_team_ids: "array",
  relevance_boost: "number",
  num_linkedin_connections: "number",
  source_index: "text",
  source_type: "text",
  external_id: "text",
  source_score: "number",
  tags: "array",
};

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

function FieldEditor({
  type,
  value,
  onChange,
}: {
  type: "text" | "number" | "date" | "array";
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const cls =
    "w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-accent focus:outline-none";
  if (type === "array") {
    return (
      <input
        type="text"
        className={cls}
        placeholder="comma-separated"
        value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
      />
    );
  }
  return (
    <input
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      step={type === "number" ? "any" : undefined}
      className={cls}
      value={value == null ? "" : String(value).slice(0, type === "date" ? 10 : undefined)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(null);
        onChange(type === "number" ? Number(raw) : raw);
      }}
    />
  );
}

export default function PersonDrawer({
  personId,
  onClose,
}: {
  personId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = usePerson(personId);
  const update = useUpdatePerson();
  const remove = useDeletePerson();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (personId == null) return null;
  const person = data?.person;

  const grouped = new Set(GROUPS.flatMap((g) => g.fields));
  const other = person ? Object.keys(person).filter((k) => !grouped.has(k)) : [];

  function startEdit() {
    setDraft({});
    setEditing(true);
  }

  async function save() {
    if (Object.keys(draft).length > 0) {
      await update.mutateAsync({ id: personId!, updates: draft });
    }
    setEditing(false);
    setDraft({});
  }

  async function doDelete() {
    await remove.mutateAsync(personId!);
    onClose();
  }

  const renderField = (f: string) => {
    if (!person) return null;
    const editable = EDITABLE[f];
    const current = f in draft ? draft[f] : person[f];
    return (
      <div key={f} className="grid grid-cols-[180px_1fr] gap-2 text-sm">
        <dt className="truncate text-slate-500" title={f}>
          {f}
        </dt>
        <dd className="min-w-0 text-slate-800">
          {editing && editable ? (
            <FieldEditor
              type={editable}
              value={current}
              onChange={(v) => setDraft((d) => ({ ...d, [f]: v }))}
            />
          ) : (
            <FieldValue value={person[f]} />
          )}
        </dd>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative z-40 flex h-full w-[520px] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">
              {typeof person?.person_name === "string"
                ? person.person_name
                : `Person #${personId}`}
            </h2>
            {person?.person_title != null && (
              <p className="truncate text-sm text-slate-500">
                {String(person.person_title)}
                {person.organization_name != null &&
                  ` at ${String(person.organization_name)}`}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editing && person && (
              <button
                onClick={startEdit}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => {
                    setEditing(false);
                    setDraft({});
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void save()}
                  disabled={update.isPending}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {update.isPending ? "Saving..." : "Save"}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        {update.isError && (
          <p className="bg-red-50 px-5 py-2 text-sm text-red-700">
            {(update.error as Error).message}
          </p>
        )}

        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading && <p className="text-sm text-slate-400">Loading...</p>}
          {isError && <p className="text-sm text-red-600">{(error as Error).message}</p>}
          {person && (
            <>
              {GROUPS.map((g) => (
                <section key={g.title} className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {g.title}
                  </h3>
                  <dl className="space-y-2">
                    {g.fields.filter((f) => f in person).map(renderField)}
                  </dl>
                </section>
              ))}
              {other.length > 0 && (
                <section className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Other
                  </h3>
                  <dl className="space-y-2">{other.map(renderField)}</dl>
                </section>
              )}

              <div className="mt-6 border-t border-slate-100 pt-4">
                {confirmDelete ? (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-red-700">Delete this record permanently?</span>
                    <button
                      onClick={() => void doDelete()}
                      disabled={remove.isPending}
                      className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                    >
                      {remove.isPending ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete record
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
