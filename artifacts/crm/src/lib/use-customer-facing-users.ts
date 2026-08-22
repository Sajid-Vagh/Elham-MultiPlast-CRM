import { useQuery } from "@tanstack/react-query";

type UserRecord = { id: number; name: string; role: string; unit: string; colorCode: string; profilePhoto?: string | null };

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

/**
 * Fetches users eligible for the owner filter dropdowns: all customer-facing
 * roles (admin, sales, production_and_support) PLUS any user who currently
 * owns at least one lead/contact — regardless of their primary role — so
 * Production / Support owners always appear and filter correctly.
 * Used by owner filter dropdowns in Dashboard, Reports, Follow-ups, Deals, Leads, Import.
 */
export function useCustomerFacingUsers() {
  const { data, isLoading } = useQuery<UserRecord[]>({
    queryKey: ["users-customer-facing"],
    queryFn: async () => {
      const res = await fetch("/api/users/contact-owners", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  return { data: data ?? [], isLoading };
}
