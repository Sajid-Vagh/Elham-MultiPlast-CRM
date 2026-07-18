/**
 * Shared constant for pending unit assignment.
 * Used across all modules to identify leads/deals without an assigned production unit.
 */
export const PENDING_UNIT_ASSIGNMENT = "To Be Assigned";

/**
 * Check if a unit value indicates "pending" (not yet assigned to a factory).
 */
export function isPendingUnit(unit: string | null | undefined): boolean {
  return !unit || unit === PENDING_UNIT_ASSIGNMENT || unit.trim() === "";
}

/**
 * Get the display label for unit filter.
 */
export function getUnitFilterLabel(unit: string): string {
  if (isPendingUnit(unit)) return "Pending Unit Assignment";
  return unit;
}
