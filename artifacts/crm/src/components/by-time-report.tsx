import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Calendar,
  Clock,
  Search,
  X,
  IndianRupee,
  ShoppingBag,
  Layers,
  ChevronRight,
  TrendingUp,
  Filter,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

type TimeMode = "weekly" | "monthly" | "yearly";
type MetricType = "value" | "orders";

interface TimeBucket {
  key: string;
  shortKey?: string;
  label?: string;
  dayIndex?: number;
  dayOfMonth?: number;
  monthIndex?: number;
  orderCount: number;
  totalValue: number;
  totalQuantity: number;
}

interface OrderItemRow {
  id: number;
  orderNumber: string;
  customerName: string;
  companyName: string;
  city: string;
  state: string;
  status: string;
  productionUnit: string;
  salesOwnerName: string;
  grandTotal: number;
  itemsCount: number;
  totalQuantity: number;
  createdAt: string;
  dayOfWeek: number;
  dayName: string;
  dayOfMonth: number;
  monthIndex: number;
  monthName: string;
}

interface ByTimeReportResponse {
  weekly: TimeBucket[];
  monthly: TimeBucket[];
  yearly: TimeBucket[];
  orders: OrderItemRow[];
  summary: {
    totalOrders: number;
    totalValue: number;
    totalQuantity: number;
  };
}

interface ByTimeReportTabProps {
  unit?: string;
  ownerId?: string;
  dateFilter?: {
    preset: string;
    startDate?: string | null;
    endDate?: string | null;
  };
}

const STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700",
  "Pending Verification": "bg-yellow-100 text-yellow-800",
  "Confirmed": "bg-blue-100 text-blue-700",
  "Production Pending": "bg-purple-100 text-purple-700",
  "Production Started": "bg-orange-100 text-orange-700",
  "Production Running": "bg-orange-100 text-orange-700",
  "Ready for Dispatch": "bg-emerald-100 text-emerald-700",
  "Dispatched": "bg-indigo-100 text-indigo-700",
  "Delivered": "bg-green-100 text-green-700",
  "Completed": "bg-emerald-100 text-emerald-800",
  "Cancelled": "bg-red-100 text-red-600",
};

export function ByTimeReportTab({ unit, ownerId, dateFilter }: ByTimeReportTabProps) {
  const [timeMode, setTimeMode] = useState<TimeMode>("weekly");
  const [metric, setMetric] = useState<MetricType>("value");
  const [selectedFilterKey, setSelectedFilterKey] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Build query parameters
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (unit && unit !== "All" && unit !== "all") p.set("unit", unit);
    if (ownerId && ownerId !== "all" && ownerId !== "All") p.set("salesOwnerId", ownerId);
    if (dateFilter) {
      if (dateFilter.preset && dateFilter.preset !== "all" && dateFilter.preset !== "custom") {
        p.set("datePreset", dateFilter.preset);
      } else {
        if (dateFilter.startDate) p.set("startDate", dateFilter.startDate);
        if (dateFilter.endDate) p.set("endDate", dateFilter.endDate);
      }
    }
    return p.toString();
  }, [unit, ownerId, dateFilter]);

  const { data, isLoading } = useQuery<ByTimeReportResponse>({
    queryKey: ["reports-by-time", queryParams],
    queryFn: () => customFetch(`/reports/by-time?${queryParams}`),
    refetchInterval: 30_000,
  });

  // Active chart dataset based on current timeframe selection
  const chartData = useMemo(() => {
    if (!data) return [];
    if (timeMode === "weekly") return data.weekly || [];
    if (timeMode === "monthly") return data.monthly || [];
    return data.yearly || [];
  }, [data, timeMode]);

  // Handle clicking on a chart bar
  const handleBarClick = (entry: any) => {
    if (!entry) return;
    const key = entry.key || entry.label;
    if (selectedFilterKey === key) {
      // Toggle off if already selected
      setSelectedFilterKey(null);
    } else {
      setSelectedFilterKey(key);
    }
    setPage(1);
  };

  // Label of the currently active filter bar
  const activeFilterInfo = useMemo(() => {
    if (!selectedFilterKey || !chartData.length) return null;
    const bucket = chartData.find(b => b.key === selectedFilterKey || b.label === selectedFilterKey);
    if (!bucket) return null;
    let title = bucket.key;
    if (timeMode === "weekly") {
      title = bucket.key; // e.g. "Wednesday"
    } else if (timeMode === "monthly") {
      title = `Day ${bucket.label || bucket.key}`; // e.g. "Day 15th"
    } else if (timeMode === "yearly") {
      title = bucket.label || bucket.key; // e.g. "April"
    }
    return {
      title,
      orderCount: bucket.orderCount,
      totalValue: bucket.totalValue,
      totalQuantity: bucket.totalQuantity,
    };
  }, [selectedFilterKey, chartData, timeMode]);

  // Filter orders based on active bar selection and search query
  const filteredOrders = useMemo(() => {
    const all = data?.orders || [];
    let list = all;

    if (selectedFilterKey) {
      if (timeMode === "weekly") {
        list = list.filter(o => o.dayName === selectedFilterKey || String(o.dayOfWeek) === selectedFilterKey);
      } else if (timeMode === "monthly") {
        list = list.filter(o => String(o.dayOfMonth) === selectedFilterKey);
      } else if (timeMode === "yearly") {
        list = list.filter(o => o.monthName === selectedFilterKey || String(o.monthIndex) === selectedFilterKey);
      }
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        (o.companyName && o.companyName.toLowerCase().includes(q)) ||
        (o.city && o.city.toLowerCase().includes(q)) ||
        (o.salesOwnerName && o.salesOwnerName.toLowerCase().includes(q))
      );
    }

    return list;
  }, [data?.orders, selectedFilterKey, timeMode, tableSearch]);

  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, page, pageSize]);

  return (
    <div className="space-y-5">
      {/* ── Header Controls: Time Mode Toggle, Metric Selector, and Summary Stats ── */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Timeframe Mode Selector */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border">
              <Button
                variant={timeMode === "weekly" ? "default" : "ghost"}
                size="sm"
                className="text-xs h-8 px-3 rounded-md"
                onClick={() => { setTimeMode("weekly"); setSelectedFilterKey(null); setPage(1); }}
              >
                Weekly (Mon - Sun)
              </Button>
              <Button
                variant={timeMode === "monthly" ? "default" : "ghost"}
                size="sm"
                className="text-xs h-8 px-3 rounded-md"
                onClick={() => { setTimeMode("monthly"); setSelectedFilterKey(null); setPage(1); }}
              >
                Monthly (1st - 31st)
              </Button>
              <Button
                variant={timeMode === "yearly" ? "default" : "ghost"}
                size="sm"
                className="text-xs h-8 px-3 rounded-md"
                onClick={() => { setTimeMode("yearly"); setSelectedFilterKey(null); setPage(1); }}
              >
                Yearly (Jan - Dec)
              </Button>
            </div>

            {/* Metric Toggle */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border">
              <Button
                variant={metric === "value" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-8 px-3 rounded-md"
                onClick={() => setMetric("value")}
              >
                <IndianRupee className="h-3.5 w-3.5 mr-1" />
                Order Value (₹)
              </Button>
              <Button
                variant={metric === "orders" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-8 px-3 rounded-md"
                onClick={() => setMetric("orders")}
              >
                <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                Order Count
              </Button>
            </div>
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3.5 rounded-lg border bg-card/60 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Orders</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-16 mt-1" />
                ) : (
                  <p className="text-xl font-bold tracking-tight mt-0.5">
                    {(data?.summary.totalOrders ?? 0).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">
                <ShoppingBag className="h-4 w-4" />
              </div>
            </div>

            <div className="p-3.5 rounded-lg border bg-card/60 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Order Value</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  <p className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-0.5">
                    ₹{(data?.summary.totalValue ?? 0).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                <IndianRupee className="h-4 w-4" />
              </div>
            </div>

            <div className="p-3.5 rounded-lg border bg-card/60 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Quantity</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-20 mt-1" />
                ) : (
                  <p className="text-xl font-bold tracking-tight mt-0.5">
                    {(data?.summary.totalQuantity ?? 0).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">pcs</span>
                  </p>
                )}
              </div>
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300">
                <Layers className="h-4 w-4" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Interactive Bar Chart Card ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-semibold">
                {timeMode === "weekly"
                  ? "Orders by Day of Week (Monday – Sunday)"
                  : timeMode === "monthly"
                  ? "Orders by Day of Month (1st – 31st)"
                  : "Orders by Month (January – December)"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click any bar to filter the orders table below
              </p>
            </div>
            {selectedFilterKey && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => setSelectedFilterKey(null)}
              >
                <X className="h-3 w-3" />
                Reset Chart Selection
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {isLoading ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, left: metric === "value" ? 35 : 15, bottom: timeMode === "monthly" ? 15 : 25 }}
                onClick={(state) => {
                  if (state && state.activePayload && state.activePayload.length > 0) {
                    handleBarClick(state.activePayload[0].payload);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: timeMode === "monthly" ? 10 : 11 }}
                  interval={timeMode === "monthly" ? 1 : 0}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(val) =>
                    metric === "value"
                      ? val >= 10000000
                        ? `₹${(val / 10000000).toFixed(1)}Cr`
                        : val >= 100000
                        ? `₹${(val / 100000).toFixed(1)}L`
                        : val >= 1000
                        ? `₹${(val / 1000).toFixed(0)}k`
                        : `₹${val}`
                      : val.toLocaleString()
                  }
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload as TimeBucket;
                      return (
                        <div className="bg-popover text-popover-foreground rounded-lg p-3 shadow-lg border text-xs space-y-1">
                          <p className="font-semibold text-sm border-b pb-1">
                            {d.label || d.key}
                          </p>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Orders:</span>
                            <span className="font-bold">{d.orderCount}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Total Value:</span>
                            <span className="font-bold text-emerald-600">₹{d.totalValue.toLocaleString("en-IN")}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Quantity:</span>
                            <span className="font-bold">{d.totalQuantity.toLocaleString()} pcs</span>
                          </div>
                          <p className="text-[10px] text-primary/80 pt-1 italic">
                            Click to filter table
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey={metric === "value" ? "totalValue" : "orderCount"}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={timeMode === "monthly" ? 18 : 45}
                  className="cursor-pointer"
                >
                  {chartData.map((entry, index) => {
                    const isSelected = selectedFilterKey === entry.key || selectedFilterKey === entry.label;
                    let fill = metric === "value" ? "#10b981" : "#3b82f6";
                    if (selectedFilterKey) {
                      fill = isSelected ? (metric === "value" ? "#047857" : "#1d4ed8") : "#cbd5e1";
                    }
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Orders Data Table Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">
                Orders List {activeFilterInfo ? `— ${activeFilterInfo.title}` : ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filteredOrders.length} order{filteredOrders.length !== 1 ? "s" : ""}
                {activeFilterInfo ? ` matching ${activeFilterInfo.title}` : " across the current period"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-48 sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search orders..."
                  value={tableSearch}
                  onChange={(e) => { setTableSearch(e.target.value); setPage(1); }}
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {tableSearch && (
                  <button
                    onClick={() => { setTableSearch(""); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Active bar filter pill banner */}
          {activeFilterInfo && (
            <div className="mt-3 flex items-center justify-between p-2.5 rounded-md bg-primary/10 border border-primary/20 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="font-semibold text-xs">
                  Filtered by: {activeFilterInfo.title}
                </Badge>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium text-foreground">
                  {activeFilterInfo.orderCount} orders
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  ₹{activeFilterInfo.totalValue.toLocaleString("en-IN")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedFilterKey(null)}
              >
                <X className="h-3.5 w-3.5" />
                Clear Filter
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
              <p>No orders found matching the selected timeframe.</p>
              {selectedFilterKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFilterKey(null)}
                  className="text-xs h-7 mt-1"
                >
                  View all timeframe orders
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Sales Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Value (₹)</TableHead>
                      <TableHead className="text-center">Products</TableHead>
                      <TableHead className="text-right">Qty (pcs)</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOrders.map((order) => {
                      const orderDate = order.createdAt
                        ? new Date(order.createdAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "-";
                      return (
                        <TableRow key={order.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="font-mono font-medium">
                            <Link href={`/orders/${order.id}`} className="hover:underline text-primary">
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {orderDate}
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {order.customerName}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {order.companyName}
                          </TableCell>
                          <TableCell className="text-xs">
                            {order.salesOwnerName}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}
                            >
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm">
                            ₹{order.grandTotal.toLocaleString("en-IN")}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {order.itemsCount}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {order.totalQuantity.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {order.productionUnit}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                  <p>
                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredOrders.length)} of {filteredOrders.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="h-7 text-xs px-2.5"
                    >
                      Previous
                    </Button>
                    <span className="px-2 text-foreground font-medium">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="h-7 text-xs px-2.5"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
