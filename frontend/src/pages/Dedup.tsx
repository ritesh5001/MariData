import { useState } from "react";
import {
  useDedupGroups,
  useMergeGroup,
  type DedupGroup,
  type DedupKey,
} from "../api/crud";

const KEYS: { key: DedupKey; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "name_org", label: "Name + Organization" },
];

export default function Dedup() {
  const [key, setKey] = useState<DedupKey>("email");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const { data, isLoading, isError, error, isFetching } = useDedupGroups(key, cursor);

  function switchKey(k: DedupKey) {
    setKey(k);
    setCursor(null);
    setCursorStack([]);
  }

  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-semibold">Dedup</h1>
      <p className="mb-4 text-sm text-slate-500">
        Find duplicate records by a shared key, pick the row to keep, and merge. Merging
        fills the survivor's empty fields from the duplicates, unions tags and other
        lists, then deletes the rest.
      </p>

      <div className="mb-4 flex items-center gap-2">
        <div className="flex rounded-md border border-slate-300 text-sm">
          {KEYS.map((k) => (
            <button
              key={k.key}
              onClick={() => switchKey(k.key)}
              className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
                key === k.key ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        {isFetching && <span className="text-xs text-slate-400">scanning...</span>}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Scanning for duplicates...</p>}
      {isError && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      {data && data.groups.length === 0 && (
        <p className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-400">
          No duplicate groups found for this key.
        </p>
      )}

      <div className="space-y-4">
        {data?.groups.map((g) => <GroupCard key={`${key}:${g.key}`} group={g} />)}
      </div>

      {data && (data.nextCursor || cursorStack.length > 0) && (
        <div className="mt-4 flex gap-2">
          <button
            disabled={cursorStack.length === 0}
            onClick={() => {
              const stack = [...cursorStack];
              const prev = stack.pop() ?? null;
              setCursorStack(stack);
              setCursor(prev === "" ? null : prev);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={!data.nextCursor}
            onClick={() => {
              setCursorStack((s) => [...s, cursor ?? ""]);
              setCursor(data.nextCursor);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: DedupGroup }) {
  const merge = useMergeGroup();
  const [survivor, setSurvivor] = useState<number>(group.members[0]?.id ?? 0);
  const mergeIds = group.members.map((m) => m.id).filter((id) => id !== survivor);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">{group.key}</span>{" "}
          <span className="text-slate-400">
            — {group.count} records
            {group.count > group.members.length &&
              ` (showing first ${group.members.length})`}
          </span>
        </div>
        <button
          onClick={() => void merge.mutateAsync({ survivorId: survivor, mergeIds })}
          disabled={merge.isPending || mergeIds.length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {merge.isPending
            ? "Merging..."
            : `Merge ${mergeIds.length} into #${survivor}`}
        </button>
      </div>
      {merge.isError && (
        <p className="mb-2 text-sm text-red-600">{(merge.error as Error).message}</p>
      )}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="px-2 py-1 font-medium">Keep</th>
            <th className="px-2 py-1 font-medium">ID</th>
            <th className="px-2 py-1 font-medium">Name</th>
            <th className="px-2 py-1 font-medium">Title</th>
            <th className="px-2 py-1 font-medium">Organization</th>
            <th className="px-2 py-1 font-medium">Country</th>
            <th className="px-2 py-1 font-medium">Tags</th>
            <th className="px-2 py-1 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {group.members.map((m) => (
            <tr
              key={m.id}
              className={`border-t border-slate-100 ${
                m.id === survivor ? "bg-accent/5" : ""
              }`}
            >
              <td className="px-2 py-1.5">
                <input
                  type="radio"
                  name={`survivor-${group.key}`}
                  checked={m.id === survivor}
                  onChange={() => setSurvivor(m.id)}
                />
              </td>
              <td className="px-2 py-1.5 tabular-nums text-slate-500">{m.id}</td>
              <td className="px-2 py-1.5">{m.person_name ?? "—"}</td>
              <td className="px-2 py-1.5">{m.person_title ?? "—"}</td>
              <td className="px-2 py-1.5">{m.organization_name ?? "—"}</td>
              <td className="px-2 py-1.5">{m.location_country ?? "—"}</td>
              <td className="px-2 py-1.5">{m.tags?.join(", ") ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                {new Date(m.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
