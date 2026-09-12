import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Building,
  Calendar,
  ChevronDown,
  ChevronRight,
  ShoppingBag,
  Package,
  Layers,
  IndianRupee,
} from "lucide-react";
import { useUnitFilter } from "@/lib/use-unit-filter";

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
  "Production Running": "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
  "Dispatch Pending": "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-800",
  "Repeat Order Due": "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
  "Inactive": "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
  "Pending Verification": "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400",
  "Confirmed": "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400",
  "Production Pending": "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400",
  "Production Started": "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400",
  "Production Running": "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400",
  "Quality Check": "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400",
  "Ready for Dispatch": "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400",
  "Partially Dispatched": "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400",
  "Dispatched": "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400",
  "Delivered": "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400",
  "Cancelled": "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400",
};

export default function ExistingCustomerDetail() {
  const { data: me } = useGetMe();
  const canViewRevenue = me?.role === "admin" || (me?.permissions?.allowViewCustomerRevenue !== false && (me as any)?.allowViewCustomerRevenue !== false);
  const [, params] = useRoute("/existing-customers/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);

  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});
  const [unitFilter] = useUnitFilter();

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const { data: customer, isLoading: isCustomerLoading } = useQuery({
    queryKey: ["existing-customer", id, unitFilter],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (unitFilter && unitFilter !== "All" && unitFilter !== "all") queryParams.set("unit", unitFilter);
      const qs = queryParams.toString();
      const res = await fetch(`/api/existing-customers/${id}${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch customer details");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: orders = [], isLoading: isOrdersLoading } = useQuery({
    queryKey: ["existing-customer-orders", id, unitFilter],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (unitFilter && unitFilter !== "All" && unitFilter !== "all") queryParams.set("unit", unitFilter);
      const qs = queryParams.toString();
      const res = await fetch(`/api/existing-customers/${id}/orders${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch customer orders");
      return res.json();
    },
    enabled: !!id,
  });

  if (!id || isNaN(id)) {
    return (
      <div className="p-8 text-center max-w-lg mx-auto">
        <p className="text-muted-foreground mb-4">Invalid customer ID.</p>
        <Button variant="outline" onClick={() => setLocation("/existing-customers")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Existing Customers
        </Button>
      </div>
    );
  }

  if (isCustomerLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-8 text-center max-w-lg mx-auto">
        <p className="text-muted-foreground mb-4">Customer not found.</p>
        <Button variant="outline" onClick={() => setLocation("/existing-customers")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Existing Customers
        </Button>
      </div>
    );
  }

  const c = customer;
  const contact = c.contact || {};

  // Format date helper
  const formatDate = (dateVal: string | null | undefined) => {
    if (!dateVal) return "-";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return String(dateVal);
    }
  };

  const customerSinceDate = c.firstOrderDate || c.firstOrderAt || contact.createdAt;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* ── Customer Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 hover:bg-muted"
            onClick={() => setLocation("/existing-customers")}
            title="Back to Existing Customers"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {contact.name || "Unnamed Customer"}
              </h1>
              {contact.customerCode && (
                <Badge variant="outline" className="font-mono text-xs font-semibold px-2 py-0.5 border-muted-foreground/30">
                  {contact.customerCode}
                </Badge>
              )}
              {c.status && (
                <Badge className={`text-xs font-medium px-2.5 py-0.5 border ${STATUS_COLORS[c.status] || "bg-muted text-muted-foreground"}`}>
                  {c.status}
                </Badge>
              )}
              {!c.isActive && (
                <Badge variant="destructive" className="text-xs">
                  Inactive
                </Badge>
              )}
            </div>
            {contact.companyName && (
              <p className="text-sm text-muted-foreground mt-0.5">{contact.companyName}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Clean Customer Info (5 Essential Fields Only: Mobile, Email, Company, City, Customer Since) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Mobile */}
        <Card className="bg-card/80 border-border/80 hover:border-border transition-colors shadow-xs">
          <CardContent className="p-3.5 flex flex-col justify-between h-full">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <Phone className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>Mobile</span>
            </div>
            {contact.mobile || (contact as any).otherPhone ? (
              <div className="space-y-0.5">
                {`${contact.mobile || ""}${(contact as any).otherPhone ? `,${(contact as any).otherPhone}` : ""}`
                  .split(",")
                  .map((m: string) => m.trim())
                  .filter(Boolean)
                  .map((clean: string, i: number) => (
                    <a
                      key={i}
                      href={`tel:${clean}`}
                      className="block font-medium text-xs sm:text-sm text-foreground hover:text-primary hover:underline transition-colors truncate"
                      title={clean}
                    >
                      {clean}
                    </a>
                  ))}
              </div>
            ) : (
              <p className="font-medium text-sm text-muted-foreground">-</p>
            )}
          </CardContent>
        </Card>

        {/* Email */}
        <Card className="bg-card/80 border-border/80 hover:border-border transition-colors shadow-xs">
          <CardContent className="p-3.5 flex flex-col justify-between h-full">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <Mail className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>Email</span>
            </div>
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="font-medium text-xs sm:text-sm text-foreground hover:text-primary hover:underline transition-colors truncate block"
                title={contact.email}
              >
                {contact.email}
              </a>
            ) : (
              <p className="font-medium text-sm text-muted-foreground">-</p>
            )}
          </CardContent>
        </Card>

        {/* Company */}
        <Card className="bg-card/80 border-border/80 hover:border-border transition-colors shadow-xs">
          <CardContent className="p-3.5 flex flex-col justify-between h-full">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <Building className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Company</span>
            </div>
            <p className="font-medium text-xs sm:text-sm text-foreground truncate" title={contact.companyName || "-"}>
              {contact.companyName || "-"}
            </p>
          </CardContent>
        </Card>

        {/* City */}
        <Card className="bg-card/80 border-border/80 hover:border-border transition-colors shadow-xs">
          <CardContent className="p-3.5 flex flex-col justify-between h-full">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>City</span>
            </div>
            <p className="font-medium text-xs sm:text-sm text-foreground truncate" title={contact.city || "-"}>
              {contact.city || "-"}
            </p>
          </CardContent>
        </Card>

        {/* Customer Since */}
        <Card className="bg-card/80 border-border/80 hover:border-border transition-colors shadow-xs col-span-2 sm:col-span-1">
          <CardContent className="p-3.5 flex flex-col justify-between h-full">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Customer Since</span>
            </div>
            <p className="font-medium text-xs sm:text-sm text-foreground truncate">
              {formatDate(customerSinceDate)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Clean Orders List (with Nested Product Expansion) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Orders</h2>
            <Badge variant="secondary" className="text-xs px-2 py-0.5">
              {orders.length}
            </Badge>
          </div>
        </div>

        {isOrdersLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-muted-foreground">
              <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No orders found for this customer.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order: any) => {
              const isExpanded = !!expandedOrders[order.id];
              const items = order.items || [];
              const orderStatus = order.status || "Draft";
              const statusClass = ORDER_STATUS_COLORS[orderStatus] || "bg-muted text-muted-foreground border-border";

              return (
                <Card
                  key={order.id}
                  className={`overflow-hidden border transition-all duration-200 ${
                    isExpanded ? "border-primary/40 shadow-sm ring-1 ring-primary/10" : "border-border/80 hover:border-border"
                  }`}
                >
                  {/* Order Row Header / Clickable Bar */}
                  <div
                    onClick={() => toggleOrderExpand(order.id)}
                    className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none bg-card hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1 rounded-md text-muted-foreground hover:text-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-primary transition-transform duration-200" />
                        ) : (
                          <ChevronRight className="h-4 w-4 transition-transform duration-200" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">
                            {order.orderNumber || `#${order.id}`}
                          </span>
                          <Badge className={`text-[11px] font-medium px-2 py-0.5 border ${statusClass}`}>
                            {orderStatus}
                          </Badge>
                          {order.isRepeatOrder && (
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400">
                              Repeat Order
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          <span>{formatDate(order.createdAt)}</span>
                          <span>•</span>
                          <span>{items.length} {items.length === 1 ? "Product" : "Products"}</span>
                          {order.salesOwner?.name && (
                            <>
                              <span>•</span>
                              <span>Sales: {order.salesOwner.name}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      {canViewRevenue && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total Amount</p>
                          <p className="font-bold text-sm text-foreground flex items-center justify-end">
                            <IndianRupee className="h-3.5 w-3.5 inline mr-0.5" />
                            {Number(order.grandTotal || 0).toLocaleString("en-IN")}
                          </p>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs font-medium text-primary hidden sm:inline-flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOrderExpand(order.id);
                        }}
                      >
                        {isExpanded ? "Hide Line Items" : "View Line Items"}
                      </Button>
                    </div>
                  </div>

                  {/* ── Expanded View: Line Items (Products) ── */}
                  {isExpanded && (
                    <div className="border-t border-border/70 bg-muted/20 p-4 space-y-2 animate-in fade-in-50 duration-200">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        <Package className="h-3.5 w-3.5 text-primary" />
                        <span>Order Line Items ({items.length})</span>
                      </div>

                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-3 text-center italic">
                          No line items found for this order.
                        </p>
                      ) : (
                        <div className="rounded-md border border-border/80 bg-background overflow-hidden overflow-x-auto shadow-2xs">
                          <Table>
                            <TableHeader className="bg-muted/50">
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="text-xs font-semibold py-2.5">Product Name</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">Bottle Weight</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">Bottle Color</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">Cap Color</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">Neck Size</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">Machine</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5">HSN</TableHead>
                                <TableHead className="text-xs font-semibold py-2.5 text-right">Qty</TableHead>
                                {canViewRevenue && (
                                  <>
                                    <TableHead className="text-xs font-semibold py-2.5 text-right">Rate</TableHead>
                                    <TableHead className="text-xs font-semibold py-2.5 text-right">Amount</TableHead>
                                  </>
                                )}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {items.map((item: any, idx: number) => {
                                const bottleColour = item.bottleColour || item.colour || null;
                                const isHexOrNamedColor = bottleColour && !bottleColour.toLowerCase().includes("natural") && !bottleColour.toLowerCase().includes("plain");

                                return (
                                  <TableRow key={item.id || idx} className="hover:bg-muted/30 transition-colors">
                                    <TableCell className="font-medium text-xs text-foreground py-2.5">
                                      {item.productName || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5">
                                      {item.bottleWeight || item.gramage || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        {isHexOrNamedColor && (
                                          <span
                                            className="w-2.5 h-2.5 rounded-full border border-border/60 shrink-0 shadow-2xs"
                                            style={{ backgroundColor: bottleColour.toLowerCase() }}
                                            title={bottleColour}
                                          />
                                        )}
                                        <span>{bottleColour || "-"}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5">
                                      {item.capColour || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5">
                                      {item.neckSize || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5">
                                      {item.machineType || item.machine || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground/80 py-2.5 font-mono">
                                      {item.hsnCode || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs font-semibold text-right py-2.5">
                                      {Number(item.quantity || 0).toLocaleString("en-IN")} {item.unit || "Pcs"}
                                    </TableCell>
                                    {canViewRevenue && (
                                      <>
                                        <TableCell className="text-xs text-right py-2.5 text-muted-foreground">
                                          ₹{Number(item.rate || 0).toLocaleString("en-IN")}
                                        </TableCell>
                                        <TableCell className="text-xs font-semibold text-right py-2.5 text-foreground">
                                          ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
