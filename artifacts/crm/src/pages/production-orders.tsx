import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, ArrowLeft, ArrowRight, Download, FileSpreadsheet, Clock, CalendarDays, MessageCircle } from "lucide-react";
import { useUserUnits } from "@/lib/use-user-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useProductionFilters, useProductionStatusFilter, useProductionDispatchFilter, useProductionPriorityFilter, useProductionOriginFilter, useProductionSearchFilter, useProductionPageFilter } from "@/lib/production-filters";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
  "Packaging": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready To Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

const DISPATCH_STATUS_COLORS: Record<string, string> = {
  "Pending Dispatch": "bg-amber-100 text-amber-700 border-amber-300",
  "Load Vehicle": "bg-blue-100 text-blue-700 border-blue-300",
  "Dispatch": "bg-purple-100 text-purple-700 border-purple-300",
  "Delivered": "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  "Low": "bg-gray-100 text-gray-600",
  "Medium": "bg-blue-100 text-blue-700",
  "High": "bg-orange-100 text-orange-700",
  "Urgent": "bg-red-100 text-red-700",
};

// Origin filter options. The `value` must match `production_orders.created_by_role`
// exactly (the API filters with `eq(created_by_role, origin)`).
const ORIGINS = [
  { value: "all", label: "All Origins" },
  { value: "admin", label: "Admin" },
  { value: "production", label: "Production" },
  { value: "sales", label: "Sales" },
  { value: "production_and_support", label: "Support" },
];

const ORIGIN_BADGES: Record<string, { label: string; className: string }> = {
  admin: { label: "ADMIN", className: "bg-amber-50 text-amber-700 border-amber-200" },
  production: { label: "PRODUCTION", className: "bg-orange-50 text-orange-700 border-orange-200" },
  sales: { label: "SALES", className: "bg-blue-50 text-blue-700 border-blue-200" },
  production_and_support: { label: "SUPPORT", className: "bg-purple-50 text-purple-700 border-purple-200" },
};

const STATUSES = [
  "all", "Pending", "Production On Going",
  "Ready To Dispatch", "Completed", "Cancelled",
];

const DISPATCH_STATUSES = [
  "all", "Pending Dispatch", "Load Vehicle", "Delivered",
];

export default function ProductionOrders() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const { units: userUnits, userUnit, locked } = useUserUnits();
  const [selectedUnit, setSelectedUnit] = useUnitFilter();
  const { toast } = useToast();

  const [globalStatus, setGlobalStatus] = useProductionStatusFilter();
  const statusSeeded = useRef(false);
  useEffect(() => {
    if (statusSeeded.current) return;
    statusSeeded.current = true;
    const s = params.get("status");
    if (s && (STATUSES as string[]).includes(s)) setGlobalStatus(s === "all" ? "All" : s);
    const d = params.get("dispatchStatus");
    if (d && (DISPATCH_STATUSES as string[]).includes(d)) setDispatchStatus(d);
    const q = params.get("search");
    if (q !== null && q !== undefined) setSearch(q);
    const p = Number(params.get("page"));
    if (Number.isFinite(p) && p > 0) setPage(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const status = globalStatus === "All" ? "all" : (STATUSES as string[]).includes(globalStatus) ? globalStatus : "all";
  const setStatus = (v: string) => setGlobalStatus(v === "all" ? "All" : v);
  const [dispatchStatus, setDispatchStatus] = useProductionDispatchFilter();
  const [priority, setPriority] = useProductionPriorityFilter();
  const [origin, setOrigin] = useProductionOriginFilter();
  const [search, setSearch] = useProductionSearchFilter();
  const [page, setPage] = useProductionPageFilter();
  const { clearAll: clearProductionFilters } = useProductionFilters();
  const [sheetDownloading, setSheetDownloading] = useState(false);
  const [sheetDateDialogOpen, setSheetDateDialogOpen] = useState(false);
  const [sheetDateFrom, setSheetDateFrom] = useState("");
  const [sheetDateTo, setSheetDateTo] = useState("");

  const buildUrl = () => {
    const p: Record<string, string> = {};
    if (status !== "all") p.status = status;
    if (dispatchStatus !== "all") p.dispatchStatus = dispatchStatus;
    if (priority !== "all") p.priority = priority;
    if (origin !== "all") p.origin = origin;
    if (selectedUnit && selectedUnit !== "All") p.unit = selectedUnit;
    if (search) p.search = search;
    p.page = String(page);
    p.limit = "15";
    return "/production/orders?" + new URLSearchParams(p).toString();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["production-orders", status, dispatchStatus, priority, origin, selectedUnit, search, page],
    queryFn: () => customFetch<any>(buildUrl()),
    enabled: !!user,
  });

  const downloadSheet = async (mode: string, startDate?: string, endDate?: string) => {
    setSheetDownloading(true);
    try {
      const token = localStorage.getItem("crm_token");
      const p = new URLSearchParams({ mode });
      if (selectedUnit && selectedUnit !== "All") p.set("unit", selectedUnit);
      if (startDate) p.set("startDate", startDate);
      if (endDate) p.set("endDate", endDate);

      const res = await fetch(`/api/production/sheet?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const date = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `production-sheet-${mode}-${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: "Download complete", description: `Production sheet (${mode}) downloaded.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setSheetDownloading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track all production orders</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={sheetDownloading}>
                <Download className="h-4 w-4 mr-2" /> Production Sheet
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => downloadSheet("updated")}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Updated Sheet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadSheet("today")}>
                <CalendarDays className="h-4 w-4 mr-2" /> Today
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadSheet("yesterday")}>
                <Clock className="h-4 w-4 mr-2" /> Yesterday
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadSheet("this-week")}>
                <CalendarDays className="h-4 w-4 mr-2" /> This Week
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadSheet("last-week")}>
                <Clock className="h-4 w-4 mr-2" /> Last Week
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadSheet("this-month")}>
                <CalendarDays className="h-4 w-4 mr-2" /> This Month
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSheetDateDialogOpen(true)}>
                <CalendarDays className="h-4 w-4 mr-2" /> Custom Range
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setLocation("/production/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order #, code, company, invoice..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Production Status" /></SelectTrigger>
          <SelectContent>
            {STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Production" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dispatchStatus} onValueChange={(v) => { setDispatchStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Dispatch Status" /></SelectTrigger>
          <SelectContent>
            {DISPATCH_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s === "all" ? "All" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>

        <Select value={origin} onValueChange={(v) => { setOrigin(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Origin" /></SelectTrigger>
          <SelectContent>
            {ORIGINS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {!locked && userUnits.length > 1 && (
          <Select value={selectedUnit} onValueChange={(v) => { setSelectedUnit(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Unit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Units</SelectItem>
              {userUnits.filter(u => u !== "All").map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <ClearFiltersButton onClear={clearProductionFilters} />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {data ? `${data.total} order${data.total !== 1 ? "s" : ""} found` : "Loading..."}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !data?.data?.length ? (
            <div className="py-12 text-center text-muted-foreground">No production orders found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Order No</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Customer</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Company Name</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Product</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Origin</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Unit</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Created By</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Priority</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Dispatch</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((order: any) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setLocation(`/production/orders/${order.id}`)}
                    >
                      <td className="py-3 px-4 font-medium font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {order.isUpdated ? (
                            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" title="Order updated — needs attention" />
                          ) : order.status === "Pending" && !order.isRead ? (
                            <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" title="New order — not viewed yet" />
                          ) : null}
                          <span>{order.masterOrderNumber || order.displayOrderId || order.orderNumber}</span>
                          {order.hasUnreadMessages ? (
                            <span title={`${order.unreadMessageCount || 1} unread message${(order.unreadMessageCount || 1) > 1 ? "s" : ""}`} className="relative inline-flex shrink-0">
                              <MessageCircle className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500/20" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-4 min-w-[160px]">
                        <p className="font-medium text-sm whitespace-normal break-words">{(() => { const n = order.customerName || "-"; const cc = order.customerCode; return cc && !n.includes(cc) ? `${n} (${cc})` : n; })()}</p>
                      </td>
                      <td className="py-3 px-4 min-w-[160px] whitespace-normal break-words">
                        <p className="text-sm text-muted-foreground">{order.companyName || "-"}</p>
                      </td>
                      <td className="py-3 px-4 min-w-[160px] whitespace-normal break-words">
                        {order.items?.[0]?.productName || "-"}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {order.createdByRole ? (
                          <Badge variant="outline" className={`text-[10px] ${ORIGIN_BADGES[order.createdByRole]?.className || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                            {ORIGIN_BADGES[order.createdByRole]?.label || order.createdByRole.toUpperCase()}
                          </Badge>
                        ) : "-"}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{order.productionUnit || "-"}</td>
                      <td className="py-3 px-4 whitespace-nowrap">{order.createdByName || "-"}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[order.priority] || "bg-gray-100"} border-0`}>
                          {order.priority}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.status] || "bg-gray-100"} border`}>
                            {order.status}
                          </Badge>
                          {order.status === "Cancelled" && !order.cancellationAcknowledged && (
                            <span className="text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 whitespace-nowrap" title="Cancellation not yet acknowledged by production">
                              Unacknowledged
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {order.dispatchStatus ? (
                          <Badge variant="outline" className={`text-xs ${DISPATCH_STATUS_COLORS[order.dispatchStatus] || "bg-gray-100"} border`}>
                            {order.dispatchStatus}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Custom Range Dialog */}
      <Dialog open={sheetDateDialogOpen} onOpenChange={setSheetDateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Production Sheet — Custom Range</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={sheetDateFrom} onChange={e => setSheetDateFrom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={sheetDateTo} onChange={e => setSheetDateTo(e.target.value)} className="mt-1" />
            </div>
            <p className="text-xs text-muted-foreground">
              Downloads all production orders created between the selected dates.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSheetDateDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!sheetDateFrom || !sheetDateTo || sheetDownloading}
              onClick={() => {
                setSheetDateDialogOpen(false);
                downloadSheet("custom", sheetDateFrom, sheetDateTo);
              }}
            >
              {sheetDownloading ? "Downloading..." : "Download"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
