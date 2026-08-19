import { useQuery } from "@tanstack/react-query";

const getHeaders = (): Record<string, string> => {
  const t = localStorage.getItem("crm_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Returns the unread lead count for the current user, computed server-side
// using the same role-based logic as the leads table (isReadByAdmin/isReadByAssignee).
// Used by the sidebar "Leads" badge so the count always matches the table dots.
export function useUnreadLeadCount() {
  const { data } = useQuery<{ unreadCount: number }>({
    queryKey: ["unread-lead-count"],
    queryFn: async () => {
      const res = await fetch("/api/contacts/unread-count", { headers: getHeaders() });
      if (!res.ok) return { unreadCount: 0 };
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return data?.unreadCount ?? 0;
}
