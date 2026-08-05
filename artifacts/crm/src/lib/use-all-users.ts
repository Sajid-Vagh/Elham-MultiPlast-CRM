import { useQuery } from "@tanstack/react-query";

type UserRecord = { id: number; name: string; role: string; unit: string; colorCode: string; profilePhoto?: string | null };

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

/**
 * Fetches ALL users across the organization (Admin, Sales, Production,
 * Production & Support, Inventory) for the "All Owners" filter dropdowns.
 * The backend `/api/users` returns every user when no `roles` filter is sent.
 */
export function useAllUsers(enabled = true) {
  const { data, isLoading } = useQuery<UserRecord[]>({
    queryKey: ["users-all"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled,
    staleTime: 5 * 60_000,
  });
  return { data: data ?? [], isLoading };
}
