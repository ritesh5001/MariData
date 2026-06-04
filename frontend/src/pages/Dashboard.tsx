import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function Dashboard() {
  const ping = useQuery({
    queryKey: ["api", "ping"],
    queryFn: () => api<{ pong: boolean }>("/api/ping"),
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">
        Foundation is live. Import, search, filters, dedup, and export arrive in the next
        phases.
      </p>
      <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm">
        <span
          className={`h-2 w-2 rounded-full ${
            ping.isSuccess ? "bg-green-500" : ping.isError ? "bg-red-500" : "bg-slate-300"
          }`}
        />
        API:{" "}
        {ping.isLoading
          ? "checking..."
          : ping.isSuccess
            ? "connected"
            : "unreachable"}
      </div>
    </div>
  );
}
