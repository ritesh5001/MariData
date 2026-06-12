import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { PersonDetail } from "./persons";

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; updates: Record<string, unknown> }) =>
      api<{ person: PersonDetail }>(`/api/persons/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify(input.updates),
      }),
    onSuccess: (data, vars) => {
      qc.setQueryData(["person", vars.id], data);
      void qc.invalidateQueries({ queryKey: ["persons"] });
      void qc.invalidateQueries({ queryKey: ["facets"] });
    },
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/persons/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["persons"] });
      void qc.invalidateQueries({ queryKey: ["facets"] });
    },
  });
}

export interface DedupMember {
  id: number;
  person_name: string | null;
  person_title: string | null;
  organization_name: string | null;
  person_email: string | null;
  person_linkedin_url: string | null;
  location_country: string | null;
  tags: string[] | null;
  created_at: string;
}

export interface DedupGroup {
  key: string;
  count: number;
  members: DedupMember[];
}

export type DedupKey = "email" | "linkedin" | "name_org";

export function useDedupGroups(key: DedupKey, cursor: string | null) {
  return useQuery({
    queryKey: ["dedup", key, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ key, limit: "20" });
      if (cursor) params.set("cursor", cursor);
      return api<{ groups: DedupGroup[]; nextCursor: string | null }>(
        `/api/dedup?${params}`
      );
    },
  });
}

export function useMergeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { survivorId: number; mergeIds: number[] }) =>
      api<{ person: Record<string, unknown>; merged: number }>("/api/dedup/merge", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dedup"] });
      void qc.invalidateQueries({ queryKey: ["persons"] });
    },
  });
}

export function useBulkTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      filterConfig?: unknown;
      ids?: number[];
      tag: string;
      action: "add" | "remove";
    }) =>
      api<{ affected: number }>("/api/bulk/tag", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["persons"] });
    },
  });
}

export function useBulkDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { filterConfig?: unknown; ids?: number[] }) =>
      api<{ affected: number }>("/api/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ ...input, confirm: true }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["persons"] });
      void qc.invalidateQueries({ queryKey: ["facets"] });
    },
  });
}
