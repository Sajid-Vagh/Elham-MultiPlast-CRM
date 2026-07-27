import { useState, useCallback, useEffect } from "react";
import { useUserUnits } from "./use-user-units";

const STORAGE_KEY = "crm_unit_filter";
const DEFAULT_UNIT = "All";

/**
 * Global unit filter hook with localStorage persistence.
 * - Defaults to "All" on fresh login (no unit restriction).
 * - Remembers last selection across page navigations and sessions.
 * - Locked users (single-unit) always see their assigned unit.
 * - Normalized values: "Himatnagar" | "Surat" | "Rajkot" | "All"
 */
export function useUnitFilter(): [string, (v: string) => void] {
  const { locked, userUnit } = useUserUnits();

  const [unit, setUnitRaw] = useState<string>(() => {
    if (locked) return userUnit;
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_UNIT;
  });

  useEffect(() => {
    if (locked) {
      setUnitRaw(userUnit);
    }
  }, [locked, userUnit]);

  const setUnit = useCallback((v: string) => {
    if (locked) return;
    setUnitRaw(v);
    localStorage.setItem(STORAGE_KEY, v);
  }, [locked]);

  return [unit, setUnit];
}
