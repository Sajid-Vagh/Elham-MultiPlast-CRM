import { useQuery } from "@tanstack/react-query";

const getHeaders = (): Record<string, string> => {
  const t = localStorage.getItem("crm_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Returns the TOTAL unread production order count for the current user, computed
// server-side using the same per-user logic as the table indicators:
//   a) Unread chat messages / voice notes
//   b) Unread newly assigned orders (blue dot)
//   c) Unread general updates (amber dot)
//   d) Unacknowledged cancellations
// Used by the sidebar "Production Orders" badge so the count always matches the
// visible unread dots in the table.
export function useUnreadProductionCount() {
  const { data } = useQuery<{ unreadCount: number }>({
    queryKey: ["unread-production-count"],
    queryFn: async () => {
      const res = await fetch("/api/production/unread-count", { headers: getHeaders() });
      if (!res.ok) return { unreadCount: 0 };
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return data?.unreadCount ?? 0;
}
