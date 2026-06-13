import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./client";

// The grid returns every typed column; values vary by column (text/number/date/array/jsonb),
// so rows are keyed loosely and the column metadata drives rendering.
export interface PersonRow {
  id: number;
  [key: string]: unknown;
}

export type PersonDetail = PersonRow & Record<string, unknown>;

export interface Total {
  kind: "estimate" | "exact" | "capped" | "timeout";
  value: number | null;
}

export interface PersonsPage {
  rows: PersonRow[];
  nextCursor: string | null;
  total?: Total;
}

export type SearchMode = "fts" | "fuzzy";
export type SortDir = "asc" | "desc";
export interface SortState {
  col: string;
  dir: SortDir;
}

export function usePersonsInfinite(
  q: string,
  mode: SearchMode,
  filterJson: string | null = null,
  sort: SortState = { col: "id", dir: "asc" }
) {
  return useInfiniteQuery({
    queryKey: ["persons", q, mode, filterJson, sort.col, sort.dir],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100", dir: sort.dir });
      if (sort.col !== "id") params.set("sort", sort.col);
      if (q) {
        params.set("q", q);
        params.set("mode", mode);
      }
      if (filterJson) params.set("filter", filterJson);
      if (pageParam != null) params.set("cursor", String(pageParam));
      return api<PersonsPage>(`/api/persons?${params}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePerson(id: number | null) {
  return useQuery({
    queryKey: ["person", id],
    queryFn: () => api<{ person: PersonDetail }>(`/api/persons/${id}`),
    enabled: id != null,
  });
}

export function formatTotal(total: Total | undefined): string {
  if (!total) return "";
  switch (total.kind) {
    case "estimate":
      return `~${(total.value ?? 0).toLocaleString()}`;
    case "exact":
      return (total.value ?? 0).toLocaleString();
    case "capped":
      return `${(total.value ?? 0).toLocaleString()}+`;
    case "timeout":
      return "many";
  }
}
