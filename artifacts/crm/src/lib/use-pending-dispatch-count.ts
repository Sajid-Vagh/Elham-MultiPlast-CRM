import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

/**
 * Count of production orders sitting in the dispatch queue right now
 * (status = "Ready To Dispatch" AND dispatchStatus is "Pending Dispatch"/null).
 *
 * Reuses /dashboard/support-kpi — the SAME endpoint and pendingDispatch value
 * the Support Dashboard "Pending Dispatch" KPI card shows — so the sidebar
 * badge always matches what the user sees there. It shares the
 * "support-dashboard-kpi" query-key prefix, so every dispatch action
 * (Ready For Dispatch / Load Vehicle / Mark Delivered) that calls
 * onProductionChange() refreshes this badge instantly, with no duplicate
 * network fetch while the Support Dashboard is open.
 */
export function usePendingDispatchCount(enabled = true) {
  const { data } = useQuery<number>({
    queryKey: ["support-dashboard-kpi"],
    queryFn: async () => {
      const json = await customFetch<any>("/dashboard/support-kpi");
      return Number(json?.pendingDispatch ?? 0);
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return data ?? 0;
}
