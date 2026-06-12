import { useState } from "react";
import { useSegments, useSaveSegment, useDeleteSegment } from "../api/facets";

export default function SegmentBar({
  currentFilter,
  onLoad,
}: {
  currentFilter: unknown | null;
  onLoad: (filterConfig: unknown) => void;
}) {
  const segments = useSegments();
  const save = useSaveSegment();
  const del = useDeleteSegment();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");

  const canSave = currentFilter != null && name.trim().length > 0 && !save.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          const seg = segments.data?.segments.find((s) => String(s.id) === e.target.value);
          if (seg) onLoad(seg.filter_config);
        }}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="">Load segment...</option>
        {segments.data?.segments.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {selected && (
        <button
          onClick={() => {
            void del.mutateAsync(Number(selected)).then(() => setSelected(""));
          }}
          className="text-xs text-slate-400 hover:text-red-600"
        >
          delete
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Segment name"
          className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          disabled={!canSave}
          onClick={() => {
            void save
              .mutateAsync({ name: name.trim(), filterConfig: currentFilter })
              .then(() => setName(""));
          }}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          title={currentFilter == null ? "Build a filter first" : "Save current filter"}
        >
          {save.isPending ? "Saving..." : "Save segment"}
        </button>
      </div>
    </div>
  );
}
