import { useState } from "react";
import { useBulkTag, useBulkDelete } from "../api/crud";
import { formatTotal, type Total } from "../api/persons";

// Bulk operations over the current filter/search result set. Delete asks for explicit
// confirmation and shows the affected-count estimate first.
export default function BulkToolbar({
  wireFilter,
  total,
}: {
  wireFilter: unknown | null;
  total: Total | undefined;
}) {
  const bulkTag = useBulkTag();
  const bulkDelete = useBulkDelete();
  const [tag, setTag] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  if (wireFilter == null) return null;
  const estimate = total ? formatTotal(total) : "?";

  async function runTag(action: "add" | "remove") {
    const t = tag.trim();
    if (!t) return;
    const { affected } = await bulkTag.mutateAsync({
      filterConfig: wireFilter,
      tag: t,
      action,
    });
    setLastResult(
      `${action === "add" ? "Tagged" : "Untagged"} ${affected.toLocaleString()} records`
    );
  }

  async function runDelete() {
    const { affected } = await bulkDelete.mutateAsync({ filterConfig: wireFilter });
    setConfirming(false);
    setLastResult(`Deleted ${affected.toLocaleString()} records`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <span className="font-medium text-amber-800">
        Bulk: {estimate} matching records
      </span>

      <input
        type="text"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder="tag name"
        className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-accent focus:outline-none"
      />
      <button
        onClick={() => void runTag("add")}
        disabled={!tag.trim() || bulkTag.isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 disabled:opacity-40"
      >
        {bulkTag.isPending ? "Working..." : "Add tag"}
      </button>
      <button
        onClick={() => void runTag("remove")}
        disabled={!tag.trim() || bulkTag.isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 disabled:opacity-40"
      >
        Remove tag
      </button>

      <div className="ml-auto flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-red-700">
              Permanently delete {estimate} records?
            </span>
            <button
              onClick={() => void runDelete()}
              disabled={bulkDelete.isPending}
              className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white disabled:opacity-40"
            >
              {bulkDelete.isPending ? "Deleting..." : "Yes, delete all"}
            </button>
            <button onClick={() => setConfirming(false)} className="text-slate-500">
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-red-600 hover:bg-red-50"
          >
            Delete matching...
          </button>
        )}
      </div>

      {(bulkTag.isError || bulkDelete.isError) && (
        <p className="w-full text-xs text-red-600">
          {((bulkTag.error ?? bulkDelete.error) as Error).message}
        </p>
      )}
      {lastResult && <p className="w-full text-xs text-amber-700">{lastResult}</p>}
    </div>
  );
}
