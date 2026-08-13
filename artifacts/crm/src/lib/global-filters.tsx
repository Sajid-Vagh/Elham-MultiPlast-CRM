import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  subDays, subMonths, subYears, startOfYear, endOfYear, format,
} from "date-fns";
import { useUserUnits } from "./use-user-units";

const UNIT_STORAGE_KEY = "crm_unit_filter";
const OWNER_STORAGE_KEY = "crm_owner_filter";
const STATUS_STORAGE_KEY = "crm_status_filter";
const DATE_STORAGE_KEY = "crm_date_filter";

export const DEFAULT_UNIT = "All";
export const DEFAULT_OWNER = "";
export const DEFAULT_STATUS = "All";

export interface DateFilterState {
  preset: string;
  startDate: string | null;
  endDate: string | null;
}

function fmt(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function computeRange(preset: string, customStart?: string | null, customEnd?: string | null): { startDate: string | null; endDate: string | null } {
  const now = new Date();
  switch (preset) {
    case "today":
      return { startDate: fmt(now), endDate: fmt(now) };
    case "yesterday": {
      const d = subDays(now, 1);
      return { startDate: fmt(d), endDate: fmt(d) };
    }
    case "this-week":
      return { startDate: fmt(startOfWeek(now, { weekStartsOn: 1 })), endDate: fmt(endOfWeek(now, { weekStartsOn: 1 })) };
    case "last-week": {
      const ws = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      const we = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      return { startDate: fmt(ws), endDate: fmt(we) };
    }
    case "this-month":
      return { startDate: fmt(startOfMonth(now)), endDate: fmt(endOfMonth(now)) };
    case "last-month": {
      const prev = subMonths(now, 1);
      return { startDate: fmt(startOfMonth(prev)), endDate: fmt(endOfMonth(prev)) };
    }
    case "this-year":
      return { startDate: fmt(startOfYear(now)), endDate: fmt(endOfYear(now)) };
    case "last-year": {
      const prev = subYears(now, 1);
      return { startDate: fmt(startOfYear(prev)), endDate: fmt(endOfMonth(new Date(prev.getFullYear(), 11, 1))) };
    }
    case "custom":
      return { startDate: customStart || null, endDate: customEnd || null };
    case "all":
    default:
      return { startDate: null, endDate: null };
  }
}

export function getLabel(preset: string): string {
  const labels: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    "this-week": "This Week",
    "last-week": "Last Week",
    "this-month": "This Month",
    "last-month": "Last Month",
    "this-year": "This Year",
    "last-year": "Last Year",
    all: "All Time",
    custom: "Custom Range",
  };
  return labels[preset] || "All Time";
}

interface GlobalFilters {
  unit: string;
  owner: string;
  status: string;
  date: DateFilterState;
}

interface GlobalFilterContextValue {
  filters: GlobalFilters;
  hasActiveFilters: boolean;
  setUnit: (v: string) => void;
  setOwner: (v: string) => void;
  setStatus: (v: string) => void;
  setDate: (preset: string, customStart?: string | null, customEnd?: string | null) => void;
  clearAllFilters: () => void;
}

const GlobalFilterContext = createContext<GlobalFilterContextValue | null>(null);

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadDate(): DateFilterState {
  try {
    const raw = localStorage.getItem(DATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const range = computeRange(parsed.preset, parsed.startDate, parsed.endDate);
      return { preset: parsed.preset, ...range };
    }
  } catch {}
  return { preset: "all", ...computeRange("all") };
}

export function GlobalFilterProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnitRaw] = useState<string>(() => loadString(UNIT_STORAGE_KEY, DEFAULT_UNIT));
  const [owner, setOwnerRaw] = useState<string>(() => loadString(OWNER_STORAGE_KEY, DEFAULT_OWNER));
  const [status, setStatusRaw] = useState<string>(() => loadString(STATUS_STORAGE_KEY, DEFAULT_STATUS));
  const [date, setDateRaw] = useState<DateFilterState>(loadDate);

  const setUnit = useCallback((v: string) => {
    setUnitRaw(v);
    try { localStorage.setItem(UNIT_STORAGE_KEY, v); } catch {}
  }, []);

  const setOwner = useCallback((v: string) => {
    setOwnerRaw(v);
    try { localStorage.setItem(OWNER_STORAGE_KEY, v); } catch {}
  }, []);

  const setStatus = useCallback((v: string) => {
    setStatusRaw(v);
    try { localStorage.setItem(STATUS_STORAGE_KEY, v); } catch {}
  }, []);

  const setDate = useCallback((preset: string, customStart?: string | null, customEnd?: string | null) => {
    const range = computeRange(preset, customStart, customEnd);
    setDateRaw({ preset, ...range });
    try {
      localStorage.setItem(DATE_STORAGE_KEY, JSON.stringify({ preset, startDate: customStart || null, endDate: customEnd || null }));
    } catch {}
  }, []);

  const clearAllFilters = useCallback(() => {
    setUnitRaw(DEFAULT_UNIT);
    setOwnerRaw(DEFAULT_OWNER);
    setStatusRaw(DEFAULT_STATUS);
    setDateRaw({ preset: "all", ...computeRange("all") });
    try {
      localStorage.removeItem(UNIT_STORAGE_KEY);
      localStorage.removeItem(OWNER_STORAGE_KEY);
      localStorage.removeItem(STATUS_STORAGE_KEY);
      localStorage.removeItem(DATE_STORAGE_KEY);
    } catch {}
  }, []);

  const value = useMemo<GlobalFilterContextValue>(() => ({
    filters: { unit, owner, status, date },
    hasActiveFilters: unit !== DEFAULT_UNIT || owner !== DEFAULT_OWNER || status !== DEFAULT_STATUS || date.preset !== "all",
    setUnit,
    setOwner,
    setStatus,
    setDate,
    clearAllFilters,
  }), [unit, owner, status, date, setUnit, setOwner, setStatus, setDate, clearAllFilters]);

  return <GlobalFilterContext.Provider value={value}>{children}</GlobalFilterContext.Provider>;
}

export function useGlobalFilters(): GlobalFilterContextValue {
  const ctx = useContext(GlobalFilterContext);
  if (!ctx) throw new Error("useGlobalFilters must be used within GlobalFilterProvider");
  return ctx;
}

export function useUnitFilter(): [string, (v: string) => void] {
  const { filters, setUnit } = useGlobalFilters();
  const { locked, userUnit } = useUserUnits();
  return [locked ? userUnit : filters.unit, locked ? () => {} : setUnit];
}

export function useDateFilter(): [DateFilterState, (preset: string, customStart?: string | null, customEnd?: string | null) => void] {
  const { filters, setDate } = useGlobalFilters();
  return [filters.date, setDate];
}

export function useOwnerFilter(): [string, (v: string) => void] {
  const { filters, setOwner } = useGlobalFilters();
  return [filters.owner, setOwner];
}

export function useStatusFilter(): [string, (v: string) => void] {
  const { filters, setStatus } = useGlobalFilters();
  return [filters.status, setStatus];
}
