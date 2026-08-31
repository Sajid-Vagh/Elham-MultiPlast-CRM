import { useState, useCallback, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPipelineReport, useGetReportByOwner, useGetReportByCity,
  useGetReportByState, useGetReportByProduct, useGetReportLostReasons, useGetMe
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, Tooltip, Sector } from "recharts";
import { TrendingUp, Users, Briefcase, DollarSign, XCircle, Download, Search, Phone, ExternalLink, Eye, Copy, ChevronDown, ChevronRight, FileSpreadsheet, FileText, CalendarIcon, ListFilter } from "lucide-react";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";
import { STAGE_CHART_COLORS, STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { useActiveUnits } from "@/lib/use-active-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";
import { useDateFilter, getLabel } from "@/lib/use-date-filter";
import type { DateFilterState } from "@/lib/use-date-filter";
import { useOwnerFilter } from "@/lib/global-filters";
import { parseNotesText } from "@/lib/parse-notes";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { ExportVerificationDialog } from "@/components/export-verification-dialog";

function UnitPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { units: activeUnits } = useActiveUnits();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue placeholder="All Units" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All Units</SelectItem>
        <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
        {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}



const PIE_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#60a5fa","#a78bfa","#f472b6","#94a3b8"];

function downloadCSV(headers: string[], rows: any[][], filename: string) {
  if (!headers.length && !rows.length) return;
  const csv = [
    headers.join(","),
    ...rows.map(r =>
      r.map(val => {
        const str = val == null ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadExcel(sheets: { name: string; headers: string[]; rows: any[][]; mergeRows?: number[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
    // Group-header rows span the full table width (+1 offset: row 0 is the header row)
    if (s.mergeRows?.length && s.headers.length > 1) {
      ws["!merges"] = s.mergeRows.map(r => ({ s: { r: r + 1, c: 0 }, e: { r: r + 1, c: s.headers.length - 1 } }));
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

// ── Dynamic export file naming ──────────────────────────────────────────────
// Default:  [TabName]_Report_[DD-MM-YYYY].xlsx   e.g. By_Product_Report_14-08-2026.xlsx
// Custom:   [TabName]_[DDMon]_to_[DDMon].xlsx    e.g. By_Product_26Jan_to_05May.xlsx

const TAB_FILE_NAMES: Record<string, string> = {
  pipeline: "Pipeline",
  "by-owner": "By_Owner",
  "by-city": "By_City",
  "by-state": "By_State",
  "by-product": "By_Product",
  "lost-reasons": "Lost_Reasons",
  "all-reports": "All_Reports",
  "raw-deals": "Raw_Deals",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-05-05" -> "05May" (used inside custom-range filenames)
function shortDatePart(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [, month, day] = parts;
  const mon = MONTHS_SHORT[Number(month) - 1];
  return `${day}${mon ?? month}`;
}

// Today as DD-MM-YYYY (used in the default filename)
function todayFileNameDate(): string {
  const n = new Date();
  const dd = String(n.getDate()).padStart(2, "0");
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${n.getFullYear()}`;
}

// Clear human-readable range, e.g. "05 May 2026" (used in the UI)
function formatRangeLabel(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function buildExportFileName(tab: string, df: DateFilterState, ext: "xlsx" | "csv", suffix = ""): string {
  const tabName = TAB_FILE_NAMES[tab] || tab;
  const isCustom = df.preset === "custom" && df.startDate && df.endDate;
  const base = isCustom
    ? `${tabName}_${shortDatePart(df.startDate!)}_to_${shortDatePart(df.endDate!)}${suffix}`
    : `${tabName}_Report_${todayFileNameDate()}${suffix}`;
  return `${base}.${ext}`;
}

export default function Reports() {
  const [unit, setUnit] = useUnitFilter();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [ownerId, setOwnerId] = useOwnerFilter();
  const [activeTab, setActiveTab] = useState("pipeline");
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"reason" | "stage">("reason");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailData, setDetailData] = useState<{ data?: any[]; records?: any[]; total: number } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [location, navigate] = useLocation();
  const [exportVerifyOpen, setExportVerifyOpen] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState<{
    type: "quick" | "detailed";
    format: "xlsx" | "csv";
  } | null>(null);

  // Deep-link support: the Dashboard's "Won Value" card navigates here with
  // `?view=won_deals`. On mount, this auto-opens the Won Deals drill-down
  // table (same view as clicking the "Won" stage row in Pipeline by Stage).
  const viewParam = useMemo(() => {
    if (typeof window === "undefined") return null;
    const search = window.location.search || (location.includes("?") ? location.split("?")[1] : "");
    if (!search) return null;
    const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
    return params.get("view");
  }, [location]);
  const openedViewRef = useRef<string | null>(null);

  // ── Drill-down (By City / State / Owner / Product) ──────────────────────
  type DrillKind = "city" | "state" | "owner" | "product";
  const [drill, setDrill] = useState<{ open: boolean; kind: DrillKind; title: string; value: string }>(
    { open: false, kind: "city", title: "", value: "" }
  );
  const openDrill = (kind: DrillKind, title: string, value: string) => {
    setDrill({ open: true, kind, title, value });
  };

  // The By City / By State aggregations ignore the unit filter (their backend
  // endpoints don't receive it), while By Owner / By Product apply it — so the
  // drill-down fetch mirrors the source tab's filters to keep row counts exact.
  const drillParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (ownerId) p.salesOwnerId = ownerId;
    if ((drill.kind === "owner" || drill.kind === "product") && unit !== "All") p.unit = unit;
    if (dateFilter.startDate) p.startDate = dateFilter.startDate;
    if (dateFilter.endDate) p.endDate = dateFilter.endDate;
    return p;
  }, [ownerId, unit, dateFilter.startDate, dateFilter.endDate, drill.kind]);
  const drillFilterKey = useMemo(() => JSON.stringify(drillParams), [drillParams]);

  const { data: drillSource, isLoading: drillLoading } = useQuery({
    queryKey: ["report-drill-deals", drillFilterKey],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams(drillParams);
      const res = await fetch(`/api/reports/raw-deals?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      const json = await res.json();
      return (json?.data ?? []) as any[];
    },
    enabled: drill.open && !!localStorage.getItem("crm_token"),
    staleTime: 30_000,
  });

  const drillDeals = useMemo(() => {
    const all = drillSource ?? [];
    const v = drill.value;
    switch (drill.kind) {
      case "city":
        return all.filter(r => (r.cityName ?? "Unknown") === v);
      case "state":
        return all.filter(r => (r.state ?? "Unknown") === v);
      case "owner":
        return all.filter(r => r.salesOwnerId != null && String(r.salesOwnerId) === v);
      case "product":
        return all.filter(r => (Array.isArray(r.products) ? r.products : []).includes(v));
      default:
        return [];
    }
  }, [drillSource, drill.kind, drill.value]);

  const drillSummary = useMemo(() => {
    const won = drillDeals.filter(d => d.stage === "Won");
    const lost = drillDeals.filter(d => d.stage === "Lost");
    return {
      total: drillDeals.length,
      won: won.length,
      lost: lost.length,
      wonValue: won.reduce((s, d) => s + Number(d.value ?? 0), 0),
    };
  }, [drillDeals]);

  const { data: summary } = useQuery({
    queryKey: ["report-summary", ownerId, unit, dateFilter.preset],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (ownerId) params.set("ownerId", ownerId);
      if (unit !== "All") params.set("unit", unit);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      const res = await fetch(`/api/reports/summary?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json() as Promise<{ totalContacts: number; totalDeals: number; wonDeals: number; lostDeals: number; activeDeals: number; totalWonValue: number; upcomingFollowUps: number; newLeadsThisMonth?: number }>;
    },
    enabled: !!localStorage.getItem("crm_token"),
    staleTime: 30_000,
  });
  const { data: pipeline } = useGetPipelineReport({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, unit: unit !== "All" ? unit : undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byOwner } = useGetReportByOwner({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, unit: unit !== "All" ? unit : undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byCity } = useGetReportByCity({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byState } = useGetReportByState({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const dealsByState = byState?.dealsByState ?? [];
  const { data: byProduct } = useGetReportByProduct({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { toast } = useToast();
  const { data: lostReasons } = useGetReportLostReasons({ startDate: dateFilter.startDate || undefined, endDate: dateFilter.endDate || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined, unit: unit !== "All" ? unit : undefined });
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const canViewAllReports = me?.role === "admin" || me?.canViewAllReports;

  const totalLost = lostReasons?.reduce((s, r) => s + r.count, 0) ?? 0;

  const goDeals = (stage?: string, owner?: number) => {
    const p = new URLSearchParams();
    if (stage) p.set("stage", stage);
    if (owner) p.set("owner", String(owner));
    navigate(`/deals?${p.toString()}`);
  };

  const ALL_TABS = ["pipeline", "by-owner", "by-city", "by-state", "by-product", "lost-reasons"];

  const buildTabSheet = (tab: string): { name: string; headers: string[]; rows: any[][] } => {
    switch (tab) {
      case "pipeline": {
        const d = pipeline ?? [];
        return {
          name: "Pipeline Report",
          headers: ["Stage", "Deals", "Total Value", "Probability"],
          rows: d.map(r => [r.stage, r.count, r.totalValue ?? 0, r.probability ?? ""]),
        };
      }
      case "by-owner": {
        const d = byOwner ?? [];
        return {
          name: "Performance by Owner",
          headers: ["Owner", "Total", "Active", "Won", "Lost", "Won Value"],
          rows: d.map(r => [r.userName, r.totalDeals, r.activeDeals, r.wonDeals, r.lostDeals, r.totalWonValue ?? 0]),
        };
      }
      case "by-city": {
        const d = [...(byCity ?? [])].sort((a, b) => (b.totalWonValue ?? 0) - (a.totalWonValue ?? 0));
        return {
          name: "Performance by City",
          headers: ["City", "Total Deals", "Won", "Won Value", "Lost"],
          rows: d.map(r => [r.city, r.totalDeals, r.wonDeals, r.totalWonValue ?? 0, r.lostDeals]),
        };
      }
      case "by-state": {
        const d = [...dealsByState].sort((a, b) => (b.totalWonValue ?? 0) - (a.totalWonValue ?? 0));
        return {
          name: "Performance by State",
          headers: ["State", "Total Deals", "Won", "Won Value", "Lost"],
          rows: d.map(r => [r.state, r.totalDeals, r.wonDeals, r.totalWonValue ?? 0, r.lostDeals]),
        };
      }
      case "by-product": {
        const d = [...(byProduct ?? [])].sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0));
        // Export ONLY detailed (leaf) rows: variant breakdowns when present.
        // Parent/grouping rows are excluded so the file has no duplicate-looking
        // aggregate entries. A product with no variants IS its own detail row.
        const rows: any[][] = [];
        for (const r of d) {
          const variants = r.variants ?? [];
          if (variants.length > 0) {
            for (const v of variants) {
              rows.push([
                `${r.productName} - ${v.weight ?? "-"} / ${v.colour ?? "-"}`,
                r.productCode ?? "",
                v.dealCount,
                v.totalQuantity ?? 0,
                v.totalValue ?? 0,
              ]);
            }
          } else {
            rows.push([r.productName, r.productCode ?? "-", r.dealCount, r.totalQuantity ?? 0, r.totalValue ?? 0]);
          }
        }
        return {
          name: "Performance by Product",
          headers: ["Product", "Code", "Deals", "Total Qty", "Total Value"],
          rows,
        };
      }
      case "lost-reasons": {
        const d = lostReasons ?? [];
        const total = d.reduce((s, r) => s + (r.count ?? 0), 0);
        return {
          name: "Lost Reasons",
          headers: ["Reason", "Deals", "Share"],
          rows: d.map(r => [r.reason, r.count, total > 0 ? Math.round((r.count / total) * 100) : 0]),
        };
      }
      default:
        return { name: "Report", headers: ["Report"], rows: [] };
    }
  };

  const executeQuickExport = (format: "xlsx" | "csv") => {
    const sheet = buildTabSheet(activeTab);
    const fname = buildExportFileName(activeTab, dateFilter, format);
    if (format === "xlsx") {
      if (!sheet.rows.length) {
        toast({ title: "Nothing to export", description: "No data in the current view.", variant: "destructive" });
        return;
      }
      downloadExcel([sheet], fname);
    } else {
      downloadCSV(sheet.headers, sheet.rows, fname);
    }
    toast({ title: "Export completed", description: `Quick ${format.toUpperCase()} downloaded (${sheet.name}).` });
  };

  const doQuickExport = (format: "xlsx" | "csv") => {
    if (me?.role === "admin") {
      setPendingExportAction({ type: "quick", format });
      setExportVerifyOpen(true);
    } else {
      executeQuickExport(format);
    }
  };

  const DETAILED_EXPORT_HEADERS = [
    "Client Name",
    "Company",
    "Mobile",
    "City",
    "State",
    "Deal Name",
    "Stage",
    "Total Qty",
    "Value",
    "Probability",
    "Lost Reason",
    "Sales Person",
    "Created Date",
  ];
  const DETAILED_QTY_COL = DETAILED_EXPORT_HEADERS.indexOf("Total Qty");
  const DETAILED_VALUE_COL = DETAILED_EXPORT_HEADERS.indexOf("Value");

  // Which dimension the Detailed Export groups raw deals by — mirrors the
  // aggregation of the currently active tab so the export explains the numbers
  // on screen instead of dumping a flat list.
  const GROUP_LABEL_BY_TAB: Record<string, string> = {
    pipeline: "Stage",
    "by-owner": "Sales Person",
    "by-city": "City",
    "by-state": "State",
    "by-product": "Product",
    "lost-reasons": "Lost Reason",
  };

  const executeDetailedExport = async (format: "xlsx" | "csv", exportAuthToken?: string) => {
    try {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (ownerId) params.set("salesOwnerId", ownerId);
      if (unit !== "All") params.set("unit", unit);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      if (exportAuthToken) params.set("exportToken", exportAuthToken);

      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (exportAuthToken) headers["X-Export-Token"] = exportAuthToken;

      const res = await fetch(`/api/reports/raw-deals?${params.toString()}`, { headers });
      if (!res.ok) {
        toast({ title: "Export failed", description: "Could not fetch raw deal data.", variant: "destructive" });
        return;
      }
      const json = await res.json();
      const fetchedRows: any[] = json?.data ?? [];
      // The Lost Reasons report is STRICTLY about lost deals: other stages have
      // no lost reason and would only land in a misleading "Not Specified"
      // group, so they are discarded from this specific export. All other tabs
      // keep every deal (missing city/state/owner fall into Unknown/Unassigned).
      const rows: any[] = activeTab === "lost-reasons"
        ? fetchedRows.filter(r => r.stage === "Lost")
        : fetchedRows;
      if (!rows.length) {
        toast({ title: "Nothing to export", description: "No deal records match the current filters.", variant: "destructive" });
        return;
      }

      // ── Group assignment per active tab ────────────────────────────────────
      // By Product explodes a deal into one entry PER product it contains
      // (with that product's own quantity); every other tab yields a single
      // group per deal.
      const groupPrefix = GROUP_LABEL_BY_TAB[activeTab] ?? "";
      const groupsOf = (r: any): { key: string; qty: number | "" }[] => {
        switch (activeTab) {
          case "pipeline":
            return [{ key: r.stage || "Unknown", qty: r.totalQuantity ?? "" }];
          case "by-owner":
            return [{ key: r.salesPerson || "Unassigned", qty: r.totalQuantity ?? "" }];
          case "by-city":
            return [{ key: r.cityName || r.city || "Unknown", qty: r.totalQuantity ?? "" }];
          case "by-state":
            return [{ key: r.state || "Unknown", qty: r.totalQuantity ?? "" }];
          case "lost-reasons":
            return [{ key: r.lostReason || "Not Specified", qty: r.totalQuantity ?? "" }];
          case "by-product": {
            // By Product export lists ONLY deals that actually have products —
            // product-less deals and unnamed products are excluded entirely.
            return (Array.isArray(r.productItems) ? r.productItems : [])
              .filter((p: any) => {
                const n = String(p?.name ?? "").trim();
                return n !== "" && n.toLowerCase() !== "unknown" && n !== "(No Product)";
              })
              .map((p: any) => ({ key: String(p.name), qty: Number(p.quantity ?? 0) }));
          }
          default:
            return [{ key: "All Deals", qty: r.totalQuantity ?? "" }];
        }
      };

      const detailRow = (r: any, qty: number | "") => [
        r.clientName,
        r.company,
        r.mobile,
        r.city,
        r.state,
        r.dealName,
        r.stage,
        qty === "" ? "" : qty,
        r.value,
        r.probability,
        r.lostReason,
        r.salesPerson,
        r.createdDate ? new Date(r.createdDate).toLocaleDateString("en-IN") : "",
      ];

      interface DetailGroup { rows: any[][]; qty: number; value: number }
      const groupMap = new Map<string, DetailGroup>();
      let detailRowCount = 0;
      for (const r of rows) {
        for (const g of groupsOf(r)) {
          if (!groupMap.has(g.key)) groupMap.set(g.key, { rows: [], qty: 0, value: 0 });
          const grp = groupMap.get(g.key)!;
          grp.rows.push(detailRow(r, g.qty));
          grp.qty += typeof g.qty === "number" ? g.qty : 0;
          grp.value += Number(r.value ?? 0);
          detailRowCount++;
        }
      }

      // Groups ranked by value (lost-reasons by count) — mirrors the tab ordering
      if (!groupMap.size) {
        toast({ title: "Nothing to export", description: "No deals match the current filters.", variant: "destructive" });
        return;
      }
      const sortedGroups = [...groupMap.entries()].sort((a, b) => {
        const [, ga] = a; const [, gb] = b;
        return activeTab === "lost-reasons"
          ? (gb.rows.length - ga.rows.length) || (gb.value - ga.value)
          : gb.value - ga.value;
      });

      // ── Sheet layout: group header → deals → group total → spacer ─────────
      const COLS = DETAILED_EXPORT_HEADERS.length;
      const blankRow = () => Array(COLS).fill("");
      const sheetRows: any[][] = [];
      const mergeRows: number[] = [];
      for (const [key, g] of sortedGroups) {
        mergeRows.push(sheetRows.length);
        sheetRows.push([`${groupPrefix}: ${key}`, ...blankRow().slice(1)]);
        for (const dr of g.rows) sheetRows.push(dr);
        const sub = blankRow();
        sub[0] = `Total (${g.rows.length} deal${g.rows.length !== 1 ? "s" : ""})`;
        sub[DETAILED_QTY_COL] = g.qty;
        sub[DETAILED_VALUE_COL] = Math.round(g.value * 100) / 100;
        sheetRows.push(sub);
        sheetRows.push(blankRow());
      }
      const grandQty = sortedGroups.reduce((s, [, g]) => s + g.qty, 0);
      const grandValue = sortedGroups.reduce((s, [, g]) => s + g.value, 0);
      const grand = blankRow();
      grand[0] = activeTab === "by-product"
        ? `GRAND TOTAL (${sortedGroups.length} products · ${detailRowCount} product-deal rows)`
        : `GRAND TOTAL (${detailRowCount} deals)`;
      grand[DETAILED_QTY_COL] = grandQty;
      grand[DETAILED_VALUE_COL] = Math.round(grandValue * 100) / 100;
      sheetRows.push(grand);

      const fname = buildExportFileName(activeTab, dateFilter, format, "_Detailed");
      const sheetName = `By ${groupPrefix || "Deal"} — Grouped`;
      if (format === "xlsx") {
        downloadExcel([{ name: sheetName, headers: DETAILED_EXPORT_HEADERS, rows: sheetRows, mergeRows }], fname);
      } else {
        downloadCSV(DETAILED_EXPORT_HEADERS, sheetRows, fname);
      }
      toast({
        title: "Export completed",
        description: `Detailed ${format.toUpperCase()} grouped by ${groupPrefix.toLowerCase() || "deal"} — ${sortedGroups.length} group${sortedGroups.length !== 1 ? "s" : ""}, ${detailRowCount} row${detailRowCount !== 1 ? "s" : ""}.`,
      });
    } catch {
      toast({ title: "Export failed", description: "Could not fetch raw deal data.", variant: "destructive" });
    }
  };

  const doDetailedExport = (format: "xlsx" | "csv") => {
    if (me?.role === "admin") {
      setPendingExportAction({ type: "detailed", format });
      setExportVerifyOpen(true);
    } else {
      executeDetailedExport(format);
    }
  };

  const handleExportVerified = async (exportToken: string) => {
    if (pendingExportAction?.type === "quick") {
      executeQuickExport(pendingExportAction.format);
    } else if (pendingExportAction?.type === "detailed") {
      await executeDetailedExport(pendingExportAction.format, exportToken);
    }
    setPendingExportAction(null);
  };

  const fetchLostDetail = useCallback(async (reason: string) => {
    setDetailLoading(true);
    setSelectedReason(reason);
    setSelectedStage(null);
    setDetailMode("reason");
    setDetailSearch("");
    try {
      const token = localStorage.getItem("crm_token");
      const p = new URLSearchParams();
      p.set("reason", reason);
      if (dateFilter.startDate) p.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) p.set("endDate", dateFilter.endDate);
      if (unit !== "All") p.set("unit", unit);
      if (ownerId) p.set("salesOwnerId", ownerId);
      const url = `/api/reports/lost-reasons/detail?${p.toString()}`;
      console.log("Fetching lost detail:", url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        setDetailOpen(true);
        const count = data.total ?? (Array.isArray(data.data) ? data.data.length : Array.isArray(data) ? data.length : 0);
        toast({ title: "Lost Records", description: `${count} records loaded` });
      } else {
        const text = await res.text();
        console.error("Lost detail fetch failed:", res.status, text);
        toast({ title: "Error", description: `Server returned ${res.status}: ${text.slice(0, 200)}`, variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to fetch lost reason detail", err);
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [dateFilter.startDate, dateFilter.endDate, unit, ownerId]);

  const fetchStageDetail = useCallback(async (stage: string) => {
    setDetailLoading(true);
    setSelectedReason(null);
    setSelectedStage(stage);
    setDetailMode("stage");
    setDetailSearch("");
    try {
      const token = localStorage.getItem("crm_token");
      const p = new URLSearchParams();
      p.set("stage", stage);
      if (dateFilter.startDate) p.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) p.set("endDate", dateFilter.endDate);
      if (unit !== "All") p.set("unit", unit);
      if (ownerId) p.set("salesOwnerId", ownerId);
      const url = `/api/reports/stage-detail?${p.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        setDetailOpen(true);
        const count = data.total ?? (Array.isArray(data.data) ? data.data.length : Array.isArray(data) ? data.length : 0);
        toast({ title: `${stage} Deals`, description: `${count} records loaded` });
      } else {
        const text = await res.text();
        console.error("Stage detail fetch failed:", res.status, text);
        toast({ title: "Error", description: `Server returned ${res.status}: ${text.slice(0, 200)}`, variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to fetch stage detail", err);
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [dateFilter.startDate, dateFilter.endDate, unit, ownerId]);

  // Deep-link: /reports?view=won_deals opens the Won Deals drill-down table
  // automatically (ref-guarded so it fires once per navigation, not on every
  // date/unit/owner filter change that re-creates fetchStageDetail).
  useEffect(() => {
    if (!viewParam || openedViewRef.current === viewParam) return;
    openedViewRef.current = viewParam;
    if (viewParam === "won_deals") {
      setActiveTab("pipeline");
      fetchStageDetail("Won");
    }
  }, [viewParam, fetchStageDetail]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">Sales analytics and performance</p>
        {dateFilter.preset !== "all" && (
          <p className="text-xs mt-2 text-muted-foreground flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            Timeline:
            <span className="font-medium text-foreground">
              {dateFilter.startDate && dateFilter.endDate
                ? `${formatRangeLabel(dateFilter.startDate)} → ${formatRangeLabel(dateFilter.endDate)}`
                : getLabel(dateFilter.preset)}
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><Briefcase className="h-8 w-8 text-primary/60" /><div><p className="text-xs text-muted-foreground">Total Deals</p><p className="text-2xl font-bold">{summary?.totalDeals ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><TrendingUp className="h-8 w-8 text-green-500/60" /><div><p className="text-xs text-muted-foreground">Won</p><p className="text-2xl font-bold text-green-600">{summary?.wonDeals ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-8 w-8 text-blue-500/60" /><div><p className="text-xs text-muted-foreground">Leads</p><p className="text-2xl font-bold">{summary?.totalContacts ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><DollarSign className="h-8 w-8 text-amber-500/60" /><div><p className="text-xs text-muted-foreground">Won Value</p><p className="text-xl font-bold">₹{Number(summary?.totalWonValue ?? 0).toLocaleString()}</p></div></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="by-owner">By Owner</TabsTrigger>
            <TabsTrigger value="by-city">By City</TabsTrigger>
            <TabsTrigger value="by-state">By State</TabsTrigger>
            <TabsTrigger value="by-product">By Product</TabsTrigger>
            <TabsTrigger value="lost-reasons">
              <XCircle className="h-3.5 w-3.5 mr-1 text-red-400" />
              Lost Reasons
            </TabsTrigger>
          </TabsList>
          <div className="flex gap-2 flex-wrap">
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            <UnitPicker value={unit} onChange={setUnit} />
            {canViewAllReports && (
              <Select value={ownerId || "all"} onValueChange={v => setOwnerId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All Owners" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <ClearFiltersButton />
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 flex-wrap mb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileText className="h-4 w-4 mr-2" />
                  <span>Quick Export (Current View)</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => doQuickExport("xlsx")}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doQuickExport("csv")}>
                    <FileText className="h-4 w-4 mr-2" /> CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  <span>Detailed Export (Complete Report)</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => doDetailedExport("xlsx")}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doDetailedExport("csv")}>
                    <FileText className="h-4 w-4 mr-2" /> CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── PIPELINE TAB ── */}
        <TabsContent value="pipeline">
          <Card>
            <CardHeader><CardTitle>Pipeline by Stage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pipeline ?? []} margin={{ top: 20, right: 30, left: 45, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="stage" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]}>
                    {pipeline?.map((entry, i) => <Cell key={i} fill={STAGE_CHART_COLORS[entry.stage] || "#94a3b8"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground text-center mb-2 mt-1">Click any row to view those deals →</p>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Deals</TableHead>
                    <TableHead>Total Value</TableHead>
                    <TableHead>Probability</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipeline?.map(row => (
                    <TableRow
                      key={row.stage}
                      className="cursor-pointer hover:bg-primary/5 transition-colors"
                      onClick={() => {
                        if (row.stage === "Won" || row.stage === "Lost") {
                          fetchStageDetail(row.stage);
                        } else {
                          goDeals(row.stage);
                        }
                      }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STAGE_CHART_COLORS[row.stage] || "#94a3b8" }} />
                          <span className="font-medium">{row.stage}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-primary">{row.count}</TableCell>
                      <TableCell>₹{Number(row.totalValue).toLocaleString()}</TableCell>
                      <TableCell>{row.probability}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY OWNER TAB ── */}
        <TabsContent value="by-owner">
          <Card>
            <CardHeader>
              <CardTitle>Performance by Sales Owner</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Click a number to view those deals in the pipeline →</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Won</TableHead>
                    <TableHead>Lost</TableHead>
                    <TableHead>Won Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOwner?.map(row => (
                    <TableRow
                      key={row.userId}
                      className="cursor-pointer hover:bg-primary/5 transition-colors"
                      onClick={() => openDrill("owner", `${row.userName} Deals`, String(row.userId))}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar profilePhoto={(row as any).profilePhoto} name={row.userName} className="w-3 h-3" />
                          <span className="font-medium">{row.userName}</span>
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:underline hover:text-primary font-medium"
                        onClick={e => { e.stopPropagation(); goDeals(undefined, row.userId); }}
                        title="View all deals for this owner"
                      >
                        {row.totalDeals}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:underline hover:text-blue-600"
                        onClick={e => { e.stopPropagation(); navigate(`/deals?owner=${row.userId}`); }}
                        title="View active deals"
                      >
                        {row.activeDeals}
                      </TableCell>
                      <TableCell
                        className="text-green-600 font-medium cursor-pointer hover:underline"
                        onClick={e => { e.stopPropagation(); goDeals("Won", row.userId); }}
                        title="View won deals"
                      >
                        {row.wonDeals}
                      </TableCell>
                      <TableCell
                        className="text-red-500 cursor-pointer hover:underline"
                        onClick={e => { e.stopPropagation(); goDeals("Lost", row.userId); }}
                        title="View lost deals"
                      >
                        {row.lostDeals}
                      </TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY CITY TAB ── */}
        <TabsContent value="by-city">
          <Card>
            <CardHeader><CardTitle>Performance by City</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground text-center mb-2">Click any row to view those deals →</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>City</TableHead>
                    <TableHead>Total Deals</TableHead>
                    <TableHead className="text-green-600">Won</TableHead>
                    <TableHead>Won Value</TableHead>
                    <TableHead className="text-red-500">Lost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(byCity ?? [])].sort((a, b) => b.totalWonValue - a.totalWonValue).map(row => (
                    <TableRow
                      key={row.city}
                      className="cursor-pointer hover:bg-primary/5 transition-colors"
                      onClick={() => openDrill("city", `${row.city} Deals`, row.city)}
                    >
                      <TableCell className="font-medium">{row.city}</TableCell>
                      <TableCell>{row.totalDeals}</TableCell>
                      <TableCell className="text-green-600 font-medium">{row.wonDeals}</TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                      <TableCell className="text-red-500 font-medium">{row.lostDeals}</TableCell>
                    </TableRow>
                  ))}
                  {(!byCity || byCity.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No deals found for the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY STATE TAB ── */}
        <TabsContent value="by-state">
          <Card>
            <CardHeader><CardTitle>Performance by State</CardTitle></CardHeader>
            <CardContent>
              {!dealsByState.length ? (
                <p className="text-sm text-muted-foreground text-center py-12">No deals found for the selected filters.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={[...dealsByState].sort((a, b) => b.totalDeals - a.totalDeals)} margin={{ top: 20, right: 30, left: 45, bottom: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="state" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                      <Tooltip
                        cursor={{ fill: "rgba(148,163,184,0.1)" }}
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                              <p className="font-medium">{d.state}</p>
                              <p>Total Deals: <span className="font-medium">{d.totalDeals}</span></p>
                              <p className="text-green-600">Won: {d.wonDeals}</p>
                              <p className="text-red-500">Lost: {d.lostDeals}</p>
                              <p className="text-muted-foreground">Won Value: ₹{Number(d.totalWonValue).toLocaleString()}</p>
                            </div>
                          );
                        }}
                      />
                      <Legend />
                      <Bar dataKey="totalDeals" name="Total Deals" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="wonDeals" name="Won Deals" fill="#34d399" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <Table className="mt-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Total Deals</TableHead>
                        <TableHead className="text-green-600">Won</TableHead>
                        <TableHead>Won Value</TableHead>
                        <TableHead className="text-red-500">Lost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...dealsByState].sort((a, b) => b.totalWonValue - a.totalWonValue).map(row => (
                        <TableRow
                          key={row.state}
                          className="cursor-pointer hover:bg-primary/5 transition-colors"
                          onClick={() => openDrill("state", `${row.state} Deals`, row.state)}
                        >
                          <TableCell className="font-medium">{row.state}</TableCell>
                          <TableCell>{row.totalDeals}</TableCell>
                          <TableCell className="text-green-600 font-medium">{row.wonDeals}</TableCell>
                          <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                          <TableCell className="text-red-500 font-medium">{row.lostDeals}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY PRODUCT TAB ── */}
        <TabsContent value="by-product">
          <Card>
            <CardHeader><CardTitle>Performance by Product</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Deals</TableHead>
                    <TableHead>Total Qty</TableHead>
                    <TableHead>Total Value</TableHead>
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byProduct?.sort((a, b) => b.totalValue - a.totalValue).map(row => {
                    const key = `${row.productId ?? "na"}-${row.productName}`;
                    const variants = row.variants || [];
                    const hasVariants = variants.length > 0;
                    const isOpen = expandedProduct === key;
                    return (
                      <Fragment key={key}>
                        <TableRow className="cursor-pointer" onClick={() => hasVariants && setExpandedProduct(isOpen ? null : key)}>
                          <TableCell>
                            {hasVariants ? (
                              isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="text-muted-foreground font-mono text-sm">{row.productCode || "-"}</TableCell>
                          <TableCell>{row.dealCount}</TableCell>
                          <TableCell>{row.totalQuantity}</TableCell>
                          <TableCell>₹{Number(row.totalValue).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={`View deals for ${row.productName}`}
                              onClick={e => { e.stopPropagation(); openDrill("product", `${row.productName} Deals`, row.productName); }}
                            >
                              <Eye className="h-4 w-4 text-primary" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && hasVariants && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/30 p-2">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Weight</TableHead>
                                    <TableHead>Colour</TableHead>
                                    <TableHead>Deals</TableHead>
                                    <TableHead>Total Qty</TableHead>
                                    <TableHead>Total Value</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {variants.map((v, vi) => (
                                    <TableRow key={vi}>
                                      <TableCell className="text-sm">{v.weight || "-"}</TableCell>
                                      <TableCell className="text-sm">{v.colour || "-"}</TableCell>
                                      <TableCell className="text-sm">{v.dealCount}</TableCell>
                                      <TableCell className="text-sm">{v.totalQuantity}</TableCell>
                                      <TableCell className="text-sm">₹{Number(v.totalValue).toLocaleString()}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {(!byProduct || byProduct.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No products found for the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── LOST REASONS TAB ── */}
        <TabsContent value="lost-reasons">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle>Lost Deals by Reason</CardTitle></CardHeader>
              <CardContent>
                {!lostReasons?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No lost deals found for the selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                      <Pie
                        data={lostReasons}
                        dataKey="count"
                        nameKey="reason"
                        cx="50%"
                        cy="50%"
                        outerRadius="75%"
                        activeIndex={activePieIndex ?? undefined}
                        activeShape={(props: any) => {
                          const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
                          return (
                            <Sector
                              cx={cx}
                              cy={cy}
                              innerRadius={innerRadius}
                              outerRadius={Math.min(outerRadius + 6, cx, cy)}
                              startAngle={startAngle}
                              endAngle={endAngle}
                              fill={fill}
                              opacity={0.85}
                            />
                          );
                        }}
                        onMouseEnter={(_: any, index: number) => setActivePieIndex(index)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        onClick={(entry: any) => fetchLostDetail(entry.reason)}
                        className="cursor-pointer"
                      >
                        {lostReasons.map((row, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} onClick={() => fetchLostDetail(row.reason)} />
                        ))}
                      </Pie>
                      <Tooltip
                        offset={20}
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          const pct = ((d.count / totalLost) * 100).toFixed(1);
                          return (
                            <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                              <p className="font-medium">{d.reason}</p>
                              <p>Lost: {d.count}</p>
                              <p className="text-muted-foreground">{pct}%</p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Reason Breakdown</span>
                  {totalLost > 0 && <span className="text-sm font-normal text-muted-foreground">{totalLost} total lost</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!lostReasons?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No data</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reason</TableHead>
                        <TableHead>Deals</TableHead>
                        <TableHead>Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lostReasons.map((row, i) => (
                        <TableRow
                          key={row.reason}
                          className="cursor-pointer hover:bg-primary/5 transition-colors"
                          onClick={() => fetchLostDetail(row.reason)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="font-medium">{row.reason}</span>
                            </div>
                          </TableCell>
                          <TableCell>{row.count}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full w-16">
                                <div
                                  className="h-2 rounded-full"
                                  style={{
                                    width: `${totalLost > 0 ? (row.count / totalLost) * 100 : 0}%`,
                                    backgroundColor: PIE_COLORS[i % PIE_COLORS.length]
                                  }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {totalLost > 0 ? Math.round((row.count / totalLost) * 100) : 0}%
                              </span>
                            </div>
                           </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── LOST REASON DETAIL SHEET ── */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-[90vw] max-w-[90vw] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-xl">
              {detailMode === "stage" ? (
                <Briefcase className="h-5 w-5 text-primary" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              {detailMode === "stage" ? `${selectedStage} Deals` : `Lost Reason: ${selectedReason}`}
            </SheetTitle>
          </SheetHeader>

              {detailLoading ? (
            <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading...</p></div>
          ) : detailData ? (
            <div className="mt-6 space-y-4">
              {/* Totals */}
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-sm"><span className="text-muted-foreground">Total Records: </span><span className="font-semibold">{detailData.total}</span></div>
              </div>

              {/* Search + Export */}
              {(() => {
                const records: any[] = detailData.data ?? detailData.records ?? [];
                const isStageMode = detailMode === "stage";
                const searchQ = detailSearch.toLowerCase();
                const filtered = detailSearch
                  ? records.filter((r: any) =>
                      (r.customerName?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.companyName?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.mobile ?? "").includes(detailSearch) ||
                      (r.city?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.salesPerson?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.notes?.toLowerCase() ?? "").includes(searchQ)
                    )
                  : records;
                return (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search records..."
                          value={detailSearch}
                          onChange={e => setDetailSearch(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
                          if (!filtered.length) return;
                          const headers = isStageMode
                            ? (selectedStage === "Won"
                                ? ["Customer Name","Company Name","Mobile","City","Sales Person","Unit","Product","Type","Won Date","Notes","Deal Value"]
                                : ["Customer Name","Company Name","Mobile","City","Sales Person","Unit","Product","Type","Lost Date","Lost Reason","Notes","Deal Value"])
                            : ["Customer Name","Company Name","Mobile","City","Sales Person","Unit","Product","Type","Lost Date","Lost Reason","Notes","Deal Value"];
                          const key: Record<string, string> = {
                            "Customer Name": "customerName",
                            "Company Name": "companyName",
                            "Mobile": "mobile",
                            "City": "city",
                            "Sales Person": "salesPerson",
                            "Unit": "unit",
                            "Product": "product",
                            "Type": "type",
                            "Lost Date": "lostDate",
                            "Won Date": "lostDate",
                            "Lost Reason": "lostReason",
                            "Notes": "notes",
                            "Deal Value": "dealValue",
                          };
                          const csv = [
                            headers.join(","),
                            ...filtered.map((r: any) =>
                              headers.map(h => {
                                const val = r[key[h]] ?? "";
                                const str = String(val);
                                return str.includes(",") || str.includes('"') || str.includes("\n")
                                  ? `"${str.replace(/"/g, '""')}"`
                                  : str;
                              }).join(",")
                            ),
                          ].join("\n");
                          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = isStageMode ? `${selectedStage}-deals.csv` : `lost-reason-${selectedReason}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => window.print()}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Print
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p>
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Customer Name</TableHead>
                            <TableHead className="whitespace-nowrap">Company Name</TableHead>
                            <TableHead className="whitespace-nowrap">Mobile</TableHead>
                            <TableHead className="whitespace-nowrap">City</TableHead>
                            <TableHead className="whitespace-nowrap">Sales Person</TableHead>
                            <TableHead className="whitespace-nowrap">Unit</TableHead>
                            <TableHead className="whitespace-nowrap">Product</TableHead>
                            <TableHead className="whitespace-nowrap">Type</TableHead>
                            <TableHead className="whitespace-nowrap">{isStageMode ? "Completed Date" : "Lost Date"}</TableHead>
                            {(!isStageMode || selectedStage !== "Won") && <TableHead className="whitespace-nowrap">Lost Reason</TableHead>}
                            <TableHead className="whitespace-nowrap">Notes</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Deal Value</TableHead>
                            <TableHead className="whitespace-nowrap text-center">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((r: any) => (
                            <TableRow key={`${r.type}-${r.id}`}>
                              <TableCell className="font-medium whitespace-nowrap">
                                <Link to={`/leads/${r.contactId}`} className="hover:underline text-primary">
                                  {r.customerName}
                                </Link>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{r.companyName}</TableCell>
                              <TableCell className="whitespace-nowrap font-mono text-sm">{r.mobile}</TableCell>
                              <TableCell className="whitespace-nowrap">{r.city}</TableCell>
                              <TableCell className="whitespace-nowrap">{r.salesPerson}</TableCell>
                              <TableCell className="whitespace-nowrap">{r.unit}</TableCell>
                              <TableCell className="whitespace-nowrap">{r.product || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge variant={r.type === "deal" ? "default" : "secondary"} className="text-xs">
                                  {r.type === "deal" ? "Deal" : "Lead"}
                                </Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {r.lostDate ? new Date(r.lostDate).toLocaleDateString() : "—"}
                              </TableCell>
                              {(!isStageMode || selectedStage !== "Won") && (
                                <TableCell className="whitespace-nowrap max-w-[140px] truncate" title={r.lostReason}>
                                  {r.lostReason}
                                </TableCell>
                              )}
                              <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground" title={parseNotesText(r.notes) || undefined}>
                                {parseNotesText(r.notes) || "—"}
                              </TableCell>
                              <TableCell className={`text-right whitespace-nowrap font-medium ${isStageMode && selectedStage === "Won" ? "text-green-600" : "text-red-500"}`}>
                                {r.dealValue ? `₹${Number(r.dealValue).toLocaleString()}` : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1 justify-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Open Customer"
                                    asChild
                                  >
                                    <Link to={`/leads/${r.contactId}`}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                  {r.dealId && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title="Open Deal"
                                      asChild
                                    >
                                      <Link to={`/leads/${r.contactId}`}>
                                        <Eye className="h-3.5 w-3.5" />
                                      </Link>
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Copy Mobile"
                                    onClick={() => { navigator.clipboard.writeText(r.mobile); }}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {filtered.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={isStageMode && selectedStage === "Won" ? 12 : 13} className="text-center py-8 text-muted-foreground">
                                No records match your search.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ── DRILL-DOWN DRAWER (By City / State / Owner / Product) ── */}
      <Sheet open={drill.open} onOpenChange={(o) => setDrill(d => ({ ...d, open: o }))}>
        <SheetContent className="sm:max-w-2xl max-w-[90vw] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-xl">
              <ListFilter className="h-5 w-5 text-primary" />
              {drill.title}
            </SheetTitle>
          </SheetHeader>

          {drillLoading ? (
            <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading deals...</p></div>
          ) : drillDeals.length === 0 ? (
            <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">No deals found for the selected filters.</p></div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* Won / Lost summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total Deals</p><p className="text-xl font-bold">{drillSummary.total}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Won</p><p className="text-xl font-bold text-green-600">{drillSummary.won}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Lost</p><p className="text-xl font-bold text-red-500">{drillSummary.lost}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Won Value</p><p className="text-lg font-bold">₹{drillSummary.wonValue.toLocaleString()}</p></CardContent></Card>
              </div>

              <p className="text-xs text-muted-foreground">{drillDeals.length} deal{drillDeals.length !== 1 ? "s" : ""} in this {drill.kind}</p>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal Name</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drillDeals.map((r: any, i: number) => (
                      <TableRow key={`${r.dealId ?? "d"}-${r.contactId ?? "c"}-${i}`}>
                        <TableCell className="font-medium whitespace-nowrap max-w-[220px] truncate" title={r.dealName}>
                          {r.dealName || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Link to={`/leads/${r.contactId}`} className="hover:underline text-primary">
                            {r.clientName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_BADGE_COLORS[r.stage] || "bg-slate-100 text-slate-700"}`}>
                            {r.stage}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right whitespace-nowrap font-medium ${r.stage === "Won" ? "text-green-600" : r.stage === "Lost" ? "text-red-500" : ""}`}>
                          {r.value ? `₹${Number(r.value).toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.salesPerson || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ExportVerificationDialog
        open={exportVerifyOpen}
        onOpenChange={(isOpen) => {
          setExportVerifyOpen(isOpen);
          if (!isOpen) setPendingExportAction(null);
        }}
        onVerified={handleExportVerified}
        exportLabel={`Reports — ${TAB_FILE_NAMES[activeTab] || activeTab}`}
      />
    </div>
  );
}
