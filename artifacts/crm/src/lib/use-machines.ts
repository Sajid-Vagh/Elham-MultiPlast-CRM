import { useQuery } from "@tanstack/react-query";

type MachineRecord = { id: string; name: string; isActive: boolean; createdAt: string; updatedAt: string };

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

/**
 * Fetches active machines from the backend.
 * Used by product forms and machine-wise reports.
 */
export function useActiveMachines() {
  const { data, isLoading } = useQuery<MachineRecord[]>({
    queryKey: ["machines-active"],
    queryFn: async () => {
      const res = await fetch("/api/machines", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch machines");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const names = (data ?? []).map(m => m.name);
  return { machines: names, allMachines: data ?? [], isLoading };
}

/**
 * Fetches ALL machines (active + inactive) for admin management.
 */
export function useAllMachines() {
  const { data, isLoading, refetch } = useQuery<MachineRecord[]>({
    queryKey: ["machines-all"],
    queryFn: async () => {
      const res = await fetch("/api/machines?all=true", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch machines");
      return res.json();
    },
    staleTime: 30_000,
  });

  return { machines: data ?? [], isLoading, refetch };
}
