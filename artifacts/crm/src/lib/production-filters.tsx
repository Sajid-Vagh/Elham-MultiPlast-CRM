import React, { createContext, useContext, useCallback, useMemo, useState } from "react";

// Production Orders page filters persisted globally (Context + localStorage),
// mirroring the Sales-side GlobalFilterProvider pattern. Production filters are
// kept on their OWN storage keys so they never bleed into the Sales pages and
// survive navigating to an order detail page and back.

const PRODUCTION_STATUS_KEY = "crm_production_status_filter";
const PRODUCTION_DISPATCH_KEY = "crm_production_dispatch_filter";
const PRODUCTION_PRIORITY_KEY = "crm_production_priority_filter";
const PRODUCTION_ORIGIN_KEY = "crm_production_origin_filter";
const PRODUCTION_SEARCH_KEY = "crm_production_search";
const PRODUCTION_PAGE_KEY = "crm_production_page";

export const DEFAULT_PRODUCTION_STATUS = "All";
export const DEFAULT_PRODUCTION_DISPATCH = "all";
export const DEFAULT_PRODUCTION_PRIORITY = "all";
export const DEFAULT_PRODUCTION_ORIGIN = "all";
export const DEFAULT_PRODUCTION_SEARCH = "";
export const DEFAULT_PRODUCTION_PAGE = 1;

export interface ProductionFilters {
  status: string;
  dispatchStatus: string;
  priority: string;
  origin: string;
  search: string;
  page: number;
}

interface ProductionFilterContextValue {
  filters: ProductionFilters;
  hasActiveFilters: boolean;
  setStatus: (v: string) => void;
  setDispatchStatus: (v: string) => void;
  setPriority: (v: string) => void;
  setOrigin: (v: string) => void;
  setSearch: (v: string) => void;
  setPage: (v: number) => void;
  clearAll: () => void;
}

const ProductionFilterContext = createContext<ProductionFilterContextValue | null>(null);

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadPage(): number {
  try {
    const raw = Number(localStorage.getItem(PRODUCTION_PAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PRODUCTION_PAGE;
  } catch {
    return DEFAULT_PRODUCTION_PAGE;
  }
}

export function ProductionFilterProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatusRaw] = useState<string>(() => loadString(PRODUCTION_STATUS_KEY, DEFAULT_PRODUCTION_STATUS));
  const [dispatchStatus, setDispatchStatusRaw] = useState<string>(() => loadString(PRODUCTION_DISPATCH_KEY, DEFAULT_PRODUCTION_DISPATCH));
  const [priority, setPriorityRaw] = useState<string>(() => loadString(PRODUCTION_PRIORITY_KEY, DEFAULT_PRODUCTION_PRIORITY));
  const [origin, setOriginRaw] = useState<string>(() => loadString(PRODUCTION_ORIGIN_KEY, DEFAULT_PRODUCTION_ORIGIN));
  const [search, setSearchRaw] = useState<string>(() => loadString(PRODUCTION_SEARCH_KEY, DEFAULT_PRODUCTION_SEARCH));
  const [page, setPageRaw] = useState<number>(loadPage);

  const setStatus = useCallback((v: string) => {
    setStatusRaw(v);
    try { localStorage.setItem(PRODUCTION_STATUS_KEY, v); } catch {}
  }, []);
  const setDispatchStatus = useCallback((v: string) => {
    setDispatchStatusRaw(v);
    try { localStorage.setItem(PRODUCTION_DISPATCH_KEY, v); } catch {}
  }, []);
  const setPriority = useCallback((v: string) => {
    setPriorityRaw(v);
    try { localStorage.setItem(PRODUCTION_PRIORITY_KEY, v); } catch {}
  }, []);
  const setOrigin = useCallback((v: string) => {
    setOriginRaw(v);
    try { localStorage.setItem(PRODUCTION_ORIGIN_KEY, v); } catch {}
  }, []);
  const setSearch = useCallback((v: string) => {
    setSearchRaw(v);
    try { localStorage.setItem(PRODUCTION_SEARCH_KEY, v); } catch {}
  }, []);
  const setPage = useCallback((v: number) => {
    setPageRaw(v);
    try { localStorage.setItem(PRODUCTION_PAGE_KEY, String(v)); } catch {}
  }, []);

  const clearAll = useCallback(() => {
    setStatusRaw(DEFAULT_PRODUCTION_STATUS);
    setDispatchStatusRaw(DEFAULT_PRODUCTION_DISPATCH);
    setPriorityRaw(DEFAULT_PRODUCTION_PRIORITY);
    setOriginRaw(DEFAULT_PRODUCTION_ORIGIN);
    setSearchRaw(DEFAULT_PRODUCTION_SEARCH);
    setPageRaw(DEFAULT_PRODUCTION_PAGE);
    try {
      localStorage.removeItem(PRODUCTION_STATUS_KEY);
      localStorage.removeItem(PRODUCTION_DISPATCH_KEY);
      localStorage.removeItem(PRODUCTION_PRIORITY_KEY);
      localStorage.removeItem(PRODUCTION_ORIGIN_KEY);
      localStorage.removeItem(PRODUCTION_SEARCH_KEY);
      localStorage.removeItem(PRODUCTION_PAGE_KEY);
    } catch {}
  }, []);

  const value = useMemo<ProductionFilterContextValue>(() => ({
    filters: { status, dispatchStatus, priority, origin, search, page },
    hasActiveFilters:
      status !== DEFAULT_PRODUCTION_STATUS ||
      dispatchStatus !== DEFAULT_PRODUCTION_DISPATCH ||
      priority !== DEFAULT_PRODUCTION_PRIORITY ||
      origin !== DEFAULT_PRODUCTION_ORIGIN ||
      search !== DEFAULT_PRODUCTION_SEARCH ||
      page !== DEFAULT_PRODUCTION_PAGE,
    setStatus,
    setDispatchStatus,
    setPriority,
    setOrigin,
    setSearch,
    setPage,
    clearAll,
  }), [status, dispatchStatus, priority, origin, search, page, setStatus, setDispatchStatus, setPriority, setOrigin, setSearch, setPage, clearAll]);

  return <ProductionFilterContext.Provider value={value}>{children}</ProductionFilterContext.Provider>;
}

export function useProductionFilters(): ProductionFilterContextValue {
  const ctx = useContext(ProductionFilterContext);
  if (!ctx) throw new Error("useProductionFilters must be used within ProductionFilterProvider");
  return ctx;
}

export function useProductionStatusFilter(): [string, (v: string) => void] {
  const { filters, setStatus } = useProductionFilters();
  return [filters.status, setStatus];
}

export function useProductionDispatchFilter(): [string, (v: string) => void] {
  const { filters, setDispatchStatus } = useProductionFilters();
  return [filters.dispatchStatus, setDispatchStatus];
}

export function useProductionPriorityFilter(): [string, (v: string) => void] {
  const { filters, setPriority } = useProductionFilters();
  return [filters.priority, setPriority];
}

export function useProductionOriginFilter(): [string, (v: string) => void] {
  const { filters, setOrigin } = useProductionFilters();
  return [filters.origin, setOrigin];
}

export function useProductionSearchFilter(): [string, (v: string) => void] {
  const { filters, setSearch } = useProductionFilters();
  return [filters.search, setSearch];
}

export function useProductionPageFilter(): [number, (v: number) => void] {
  const { filters, setPage } = useProductionFilters();
  return [filters.page, setPage];
}
