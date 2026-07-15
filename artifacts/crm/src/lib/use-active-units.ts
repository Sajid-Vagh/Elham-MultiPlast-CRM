import { useQuery } from "@tanstack/react-query";

type UnitRecord = { id: string; name: string; isActive: boolean; createdAt: string; updatedAt: string };

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

/**
 * Fetches active units from the backend.
 * Used by all dropdowns across the CRM.
 */
export function useActiveUnits() {
  const { data, isLoading } = useQuery<UnitRecord[]>({
    queryKey: ["units-active"],
    queryFn: async () => {
      const res = await fetch("/api/units", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch units");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const names = (data ?? []).map(u => u.name);
  return { units: names, allUnits: data ?? [], isLoading };
}

/**
 * Fetches ALL units (active + inactive) for admin management.
 */
export function useAllUnits() {
  const { data, isLoading, refetch } = useQuery<UnitRecord[]>({
    queryKey: ["units-all"],
    queryFn: async () => {
      const res = await fetch("/api/units?all=true", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch units");
      return res.json();
    },
    staleTime: 30_000,
  });

  return { units: data ?? [], isLoading, refetch };
}
