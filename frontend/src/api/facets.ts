import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { SearchMode } from "./persons";

export interface FacetBucket {
  value: string;
  count: number;
}

export type FacetResult = Record<string, FacetBucket[] | "timeout">;

export function useFacets(filterJson: string | null, q: string, mode: SearchMode) {
  return useQuery({
    queryKey: ["facets", filterJson, q, mode],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterJson) params.set("filter", filterJson);
      if (q) {
        params.set("q", q);
        params.set("mode", mode);
      }
      return api<{ facets: FacetResult; sampleCap: number }>(`/api/facets?${params}`);
    },
    staleTime: 30_000,
  });
}

export interface Segment {
  id: number;
  name: string;
  filter_config: unknown;
  created_at: string;
}

export function useSegments() {
  return useQuery({
    queryKey: ["segments"],
    queryFn: () => api<{ segments: Segment[] }>("/api/segments"),
  });
}

export function useSaveSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; filterConfig: unknown }) =>
      api<{ segment: Segment }>("/api/segments", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["segments"] }),
  });
}

export function useDeleteSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/segments/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["segments"] }),
  });
}
