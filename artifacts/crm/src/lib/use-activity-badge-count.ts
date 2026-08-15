import { useQuery } from "@tanstack/react-query";
import { dedupeById } from "@/lib/parse-notes";

// Single, globally consistent data source for the sidebar "Activity" badge.
//
// It fetches ALL of the current user's Pending activities (role-scoped and
// unit-scoped server-side via `/api/activities?callStatus=Pending`). "Pending"
// is exactly the union of the Activity page's "Pending" (today/upcoming) and
// "Overdue" (past-due but still pending) filters — every overdue follow-up is
// still pending, so a plain pending count covers both.
//
// The query uses a stable key + `staleTime` + a 30s `refetchInterval`, so the
// badge reads from one source on every page (Dashboard, Activity, anywhere
// else) and never fluctuates between screens.
export function useActivityBadgeCount(): number {
  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;

  const { data } = useQuery({
    queryKey: ["activity-badge-count"],
    queryFn: async () => {
      const res = await fetch("/api/activities?callStatus=Pending", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch activity count");
      const list = (await res.json()) as unknown;
      return Array.isArray(list) ? dedupeById(list as { id?: number | string | null }[]).length : 0;
    },
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  return data ?? 0;
}
