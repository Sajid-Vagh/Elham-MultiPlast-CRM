import { useGetMe } from "@workspace/api-client-react";

/**
 * Returns the list of units a user can access, plus whether the dropdown should be locked.
 *
 * - admin / unit="All":  { units: ["All","Himatnagar","Surat","Rajkot"], locked: false }
 * - unit="Himatnagar":   { units: ["Himatnagar"], locked: true }
 * - unit="Surat":        { units: ["Surat"], locked: true }
 * - unit="Rajkot":       { units: ["Rajkot"], locked: true }
 */
export function useUserUnits() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const userUnit = user?.unit || "All";
  const canSeeAll = isAdmin || userUnit === "All";

  const units = canSeeAll
    ? ["All", "Himatnagar", "Surat", "Rajkot"]
    : [userUnit];

  const locked = !canSeeAll;

  return { units, locked, userUnit };
}
