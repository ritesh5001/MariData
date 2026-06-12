import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface PersonRow {
  id: number;
  person_name: string | null;
  person_title: string | null;
  person_seniority: string | null;
  organization_name: string | null;
  person_email: string | null;
  person_email_status: string | null;
  person_phone: string | null;
  person_linkedin_url: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  num_linkedin_connections: number | null;
  job_start_date: string | null;
  tags: string[] | null;
}

export type PersonDetail = PersonRow & Record<string, unknown>;

export interface Total {
  kind: "estimate" | "exact" | "capped" | "timeout";
  value: number | null;
}

export interface PersonsPage {
  rows: PersonRow[];
  nextCursor: number | null;
  total?: Total;
}

export type SearchMode = "fts" | "fuzzy";

export function usePersonsInfinite(q: string, mode: SearchMode) {
  return useInfiniteQuery({
    queryKey: ["persons", q, mode],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (q) {
        params.set("q", q);
        params.set("mode", mode);
      }
      if (pageParam != null) params.set("cursor", String(pageParam));
      return api<PersonsPage>(`/api/persons?${params}`);
    },
    initialPageParam: null as number | null,
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
