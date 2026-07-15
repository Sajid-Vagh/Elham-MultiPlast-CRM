/**
 * Shared unit-based data isolation helper.
 *
 * Rules:
 *   - admin role: sees ALL data (no unit filter)
 *   - user.unit === "All": sees ALL data (no unit filter)
 *   - user.unit === "Surat" / "Himatnagar" / "Rajkot": sees ONLY that unit's data
 *
 * Returns null when no filter is needed (admin or "All").
 * Returns string[] when only specific units are allowed.
 */
export function getAccessibleUnits(user: { role: string; unit?: string | null }): string[] | null {
  if (user.role === "admin") return null;
  const u = user.unit || "All";
  if (u === "All") return null;
  return [u];
}
