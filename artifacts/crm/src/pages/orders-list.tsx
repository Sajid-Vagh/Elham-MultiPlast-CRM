import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Search, Calendar, ChevronDown, ChevronRight, Filter, X, RefreshCw } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useActiveUnits } from "@/lib/use-active-units";

const PROD_STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-600",
  "Accepted": "bg-blue-100 text-blue-700",
  "Planning": "bg-indigo-100 text-indigo-700",
  "In Production": "bg-orange-100 text-orange-700",
  "Packing": "bg-yellow-100 text-yellow-700",
  "Ready For Dispatch": "bg-green-100 text-green-700",
  "In Transport": "bg-purple-100 text-purple-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-600",
};

const DISPATCH_STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-600",
  "In Transport": "bg-purple-100 text-purple-700",
  "Delivered": "bg-green-100 text-green-700",
  "Completed": "bg-emerald-100 text-emerald-700",
};

const DATE_PRESETS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This Week" },
  { value: "this-month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

interface OrderRow {
  id: number;
  orderNumber: string;
  customerName: string;
  companyName: string;
  mobile: string;
  grandTotal: number;
  createdAt: string;
  productionUnit: string;
  isRepeatOrder: boolean;
  salesOwner: { name: string } | null;
  supportOwner: { name: string } | null;
  productionStatus: string | null;
  dispatchStatus: string | null;
  itemsCount: number;
  totalQuantity: number;
  formattedOrderId: string | null;
  customerCode: string | null;
  products: { productName: string; bottleWeight: string | null; bottleColour: string | null; machineType: string | null; quantity: number }[];
}

export default function OrdersList() {
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const { units: activeUnits } = useActiveUnits();

  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [dispatchStatusFilter, setDispatchStatusFilter] = useState("All");
  const [productionUnitFilter, setProductionUnitFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const showUnitFilter = user?.role === "admin" || user?.role === "production_and_support" || user?.unit === "All";

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (datePreset !== "all") params.set("datePreset", datePreset);
  if (datePreset === "custom" && customStartDate) params.set("startDate", customStartDate);
  if (datePreset === "custom" && customEndDate) params.set("endDate", customEndDate);
  if (dispatchStatusFilter !== "All") params.set("dispatchStatus", dispatchStatusFilter);
  if (productionUnitFilter !== "All") params.set("productionUnit", productionUnitFilter);
  params.set("page", String(page));
  params.set("limit", "30");

  const { data, isLoading, isRefetching, refetch } = useQuery<{ data: OrderRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>({
    queryKey: ["orders-global", search, datePreset, customStartDate, customEndDate, dispatchStatusFilter, productionUnitFilter, page],
    queryFn: () => customFetch(`/orders/global?${params.toString()}`),
    refetchInterval: 30_000,
  });

  const orders = data?.data || [];
  const pagination = data?.pagination;

  const toggleExpand = useCallback((id: number) => {
    setExpandedRow(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">Track and manage all orders across the organization</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by order #, customer, company, mobile..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
            </div>

            <Select value={datePreset} onValueChange={v => { setDatePreset(v); setPage(1); }}>
              <SelectTrigger className="w-36"><Calendar className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="Date" /></SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {datePreset === "custom" && (
              <>
                <Input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-40" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-40" />
              </>
            )}

            <Select value={dispatchStatusFilter} onValueChange={v => { setDispatchStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Dispatch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Dispatch</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Transport">In Transport</SelectItem>
                <SelectItem value="Delivered">Delivered</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
              </SelectContent>
            </Select>

            {showUnitFilter && (
              <Select value={productionUnitFilter} onValueChange={v => { setProductionUnitFilter(v); setPage(1); }}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Units</SelectItem>
                  {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {(search || datePreset !== "all" || dispatchStatusFilter !== "All" || productionUnitFilter !== "All") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setDatePreset("all"); setDispatchStatusFilter("All"); setProductionUnitFilter("All"); setPage(1); }}>
                <X className="h-3.5 w-3.5 mr-1" />Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-medium">No orders found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Order No</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Sales Owner</TableHead>
                    <TableHead>Production</TableHead>
                    <TableHead>Dispatch</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-center">Products</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <>
                      <TableRow
                        key={order.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => toggleExpand(order.id)}
                      >
                        <TableCell className="w-8">
                          {expandedRow === order.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="font-mono">{order.orderNumber}</span>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{(() => { const n = order.companyName || order.customerName || "-"; const cc = order.customerCode; return cc && !n.includes(cc) ? `${n} (${cc})` : n; })()}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                        <TableCell className="text-sm">{order.salesOwner?.name || "-"}</TableCell>
                        <TableCell>
                          {order.productionStatus && (
                            <Badge className={`text-[10px] ${PROD_STATUS_COLORS[order.productionStatus] || "bg-gray-100"}`}>{order.productionStatus}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {order.dispatchStatus && (
                            <Badge className={`text-[10px] ${DISPATCH_STATUS_COLORS[order.dispatchStatus] || "bg-gray-100"}`}>{order.dispatchStatus}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-center text-sm">{order.itemsCount}</TableCell>
                        <TableCell className="text-right text-sm">{order.totalQuantity.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{order.productionUnit || "-"}</TableCell>
                      </TableRow>
                      {expandedRow === order.id && (
                        <TableRow key={`${order.id}-expanded`}>
                          <TableCell colSpan={11} className="bg-muted/20 p-4">
                            <div className="space-y-3">
                              <div className="flex items-center gap-3 flex-wrap">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Products ({order.products?.length || 0})</p>
                                <Button variant="link" size="sm" className="text-xs h-6" onClick={(e) => { e.stopPropagation(); setLocation(`/orders/${order.id}`); }}>
                                  View Full Details
                                </Button>
                              </div>
                              {order.products && order.products.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {order.products.map((p, idx) => (
                                    <div key={idx} className="border rounded-md p-2.5 text-xs space-y-1 bg-white">
                                      <p className="font-semibold">{p.productName}</p>
                                      {p.bottleWeight && <p className="text-muted-foreground">Weight: <span className="font-medium text-foreground">{p.bottleWeight}</span></p>}
                                      {p.bottleColour && (
                                        <p className="text-muted-foreground">Color: <span className="font-medium text-foreground flex items-center gap-1 inline-flex">
                                          <span className="w-2 h-2 rounded-full border inline-block" style={{ backgroundColor: p.bottleColour.toLowerCase() }} />
                                          {p.bottleColour}
                                        </span></p>
                                      )}
                                      {p.machineType && <p className="text-muted-foreground">Machine: <span className="font-medium text-foreground">{p.machineType}</span></p>}
                                      <p className="text-muted-foreground">Qty: <span className="font-medium text-foreground">{Number(p.quantity || 0).toLocaleString()}</span></p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">No product details available</p>
                              )}
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                {order.salesOwner && <span>Sales: <span className="font-medium text-foreground">{order.salesOwner.name}</span></span>}
                                {order.supportOwner && <span>Support: <span className="font-medium text-foreground">{order.supportOwner.name}</span></span>}
                                {order.isRepeatOrder && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Repeat Order</Badge>}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((pagination.page - 1) * pagination.limit) + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} orders
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm py-1 px-3">Page {page} of {pagination.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
