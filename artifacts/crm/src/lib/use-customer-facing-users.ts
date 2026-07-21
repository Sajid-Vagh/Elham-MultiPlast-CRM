import { useQuery } from "@tanstack/react-query";

/**
 * Customer-facing roles that own and manage customers, deals, and revenue.
 * Used by all owner filter dropdowns across the CRM.
 */
export const CUSTOMER_FACING_ROLES = ["admin", "sales", "production_and_support"];

const ROLES_PARAM = CUSTOMER_FACING_ROLES.join(",");

type UserRecord = { id: number; name: string; role: string; unit: string; colorCode: string; profilePhoto?: string | null };

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("crm_token")}` };
}

/**
 * Fetches only customer-facing users (admin, sales, production_and_support).
 * Used by owner filter dropdowns in Dashboard, Reports, Follow-ups, Deals, Leads, Import.
 * Excludes production, inventory, and other internal operational roles.
 */
export function useCustomerFacingUsers() {
  const { data, isLoading } = useQuery<UserRecord[]>({
    queryKey: ["users-customer-facing"],
    queryFn: async () => {
      const res = await fetch(`/api/users?roles=${ROLES_PARAM}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  return { data: data ?? [], isLoading };
}
