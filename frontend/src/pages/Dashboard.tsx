import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface Stats {
  totalRows: number;
  disk: { total: string; table: string; indexes: string };
  topCountries: { value: string; count: number }[];
  topTitles: { value: string; count: number }[];
  recentImports: {
    id: number;
    filename: string | null;
    status: string;
    stage: string | null;
    rows_inserted: number;
    started_at: string;
    finished_at: string | null;
  }[];
  segmentCount: number;
  sampleSize: number;
}

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<Stats>("/api/stats"),
    refetchInterval: 30_000,
  });
  const s = stats.data;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-2 text-2xl font-semibold">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">
        Live view of the people database. Counts are planner estimates — instant at any
        scale.
      </p>

      {stats.isError && (
        <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {(stats.error as Error).message}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="People"
          value={s ? `~${s.totalRows.toLocaleString()}` : "..."}
          to="/browse"
        />
        <StatCard label="On disk" value={s?.disk.total ?? "..."} sub={s ? `table ${s.disk.table} + indexes ${s.disk.indexes}` : undefined} />
        <StatCard label="Saved segments" value={s ? String(s.segmentCount) : "..."} to="/browse" />
        <StatCard
          label="Imports"
          value={s ? String(s.recentImports.length > 0 ? s.recentImports[0]!.status : "none yet") : "..."}
          sub={s?.recentImports[0]?.filename?.split("/").pop() ?? undefined}
          to="/import"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FacetCard title="Top countries" buckets={s?.topCountries} />
        <FacetCard title="Top titles" buckets={s?.topTitles} />
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Recent imports</h2>
          <Link to="/import" className="text-xs text-accent hover:underline">
            Import data
          </Link>
        </div>
        {s && s.recentImports.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-400">
            No imports yet. Start by importing your TSV on the Import page.
          </p>
        )}
        {s && s.recentImports.length > 0 && (
          <table className="w-full text-left text-sm">
            <tbody>
              {s.recentImports.map((j) => (
                <tr key={j.id} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-500">#{j.id}</td>
                  <td className="max-w-64 truncate px-4 py-2">{j.filename ?? "upload"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        j.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : j.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-accent/10 text-accent"
                      }`}
                    >
                      {j.status === "running" ? (j.stage ?? "running") : j.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {j.rows_inserted.toLocaleString()} rows
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-400">
                    {new Date(j.started_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: string;
  sub?: string;
  to?: string;
}) {
  const body = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-400">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function FacetCard({
  title,
  buckets,
}: {
  title: string;
  buckets: { value: string; count: number }[] | undefined;
}) {
  const max = buckets?.[0]?.count ?? 1;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {!buckets && <p className="text-xs text-slate-400">Loading...</p>}
      {buckets && buckets.length === 0 && (
        <p className="text-xs text-slate-400">No data yet.</p>
      )}
      <ul className="space-y-1.5">
        {buckets?.map((b) => (
          <li key={b.value} className="flex items-center gap-2 text-sm">
            <span className="w-28 truncate text-slate-600" title={b.value}>
              {b.value}
            </span>
            <div className="h-2.5 flex-1 rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-accent/60"
                style={{ width: `${Math.max(2, (b.count / max) * 100)}%` }}
              />
            </div>
            <span className="w-16 text-right text-xs tabular-nums text-slate-400">
              {b.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
