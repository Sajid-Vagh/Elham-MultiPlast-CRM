import { useState, useCallback } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  subDays, subMonths, subYears, startOfYear, endOfYear, format,
} from "date-fns";

const STORAGE_KEY = "crm_date_filter";

export interface DateFilterState {
  preset: string;
  startDate: string | null;
  endDate: string | null;
}

function fmt(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function computeRange(preset: string, customStart?: string | null, customEnd?: string | null): { startDate: string | null; endDate: string | null } {
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

function getLabel(preset: string): string {
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

function loadState(): DateFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const range = computeRange(parsed.preset, parsed.startDate, parsed.endDate);
      return { preset: parsed.preset, ...range };
    }
  } catch {}
  return { preset: "all", ...computeRange("all") };
}

export function useDateFilter(): [DateFilterState, (preset: string, customStart?: string | null, customEnd?: string | null) => void] {
  const [state, setStateRaw] = useState<DateFilterState>(loadState);

  const setFilter = useCallback((preset: string, customStart?: string | null, customEnd?: string | null) => {
    const range = computeRange(preset, customStart, customEnd);
    const next: DateFilterState = { preset, ...range };
    setStateRaw(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset, startDate: customStart || null, endDate: customEnd || null }));
  }, []);

  return [state, setFilter];
}

export { getLabel, computeRange };
