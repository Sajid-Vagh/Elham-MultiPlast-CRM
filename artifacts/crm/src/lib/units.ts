/**
 * @deprecated Use `useActiveUnits()` hook instead for dynamic units from the database.
 * This file is kept only for backward compatibility during the migration period.
 * All dropdowns should use `useActiveUnits()` from `@/lib/use-active-units`.
 */
export const UNITS = ["Himatnagar", "Surat", "Rajkot", "Not Sure"] as const;

export type Unit = typeof UNITS[number];
