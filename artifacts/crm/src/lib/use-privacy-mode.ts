import { useState, useCallback } from "react";

const STORAGE_KEY = "crm_dashboard_privacy";

/**
 * Dashboard privacy mode hook with localStorage persistence.
 * When enabled, financial values (Won Value, Revenue, etc.) are masked with asterisks.
 * Non-financial values (counts, percentages, charts) remain visible.
 * Persists across page navigations within the same session.
 * Resets to visible on logout (localStorage cleared).
 */
export function usePrivacyMode(): [boolean, () => void] {
  const [hidden, setHidden] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === "on";
  });

  const toggle = useCallback(() => {
    setHidden(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  return [hidden, toggle];
}
