import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";

interface MeResponse {
  authenticated: boolean;
  user: string;
}

// Resolves the current session by hitting /auth/me. A 401 resolves to null (not an error)
// so route guards can branch cleanly.
export function useAuth() {
  return useQuery<MeResponse | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api<MeResponse>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api<{ ok: true }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}
