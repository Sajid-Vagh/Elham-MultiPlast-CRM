import { useGetMe } from "@workspace/api-client-react";
import { useActiveUnits } from "./use-active-units";

/**
 * Returns the list of units a user can access, plus whether the dropdown should be locked.
 *
 * - admin / unit="All":  { units: ["All", ...dynamicActiveUnits], locked: false }
 * - unit="Himatnagar":   { units: ["Himatnagar"], locked: true }
 */
export function useUserUnits() {
  const { data: user } = useGetMe();
  const { units: activeUnits } = useActiveUnits();
  const isAdmin = user?.role === "admin";
  const userUnit = user?.unit || "All";
  const canSeeAll = isAdmin || userUnit === "All";

  const units = canSeeAll
    ? ["All", ...activeUnits]
    : [userUnit];

  const locked = !canSeeAll;

  return { units, locked, userUnit };
}
