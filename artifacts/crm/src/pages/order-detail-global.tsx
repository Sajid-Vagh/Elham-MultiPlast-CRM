import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Package, User, Truck, Calendar, Clock, CheckCircle2, Circle, Loader2, AlertTriangle, MessageSquare } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { ProductionProgressSection } from "@/components/production-progress";

const ORDER_STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-600",
  "Pending Verification": "bg-yellow-100 text-yellow-700",
  "Confirmed": "bg-blue-100 text-blue-700",
  "Production Pending": "bg-orange-100 text-orange-700",
  "Production Started": "bg-purple-100 text-purple-700",
  "Production Running": "bg-purple-100 text-purple-700",
  "Quality Check": "bg-indigo-100 text-indigo-700",
  "Ready for Dispatch": "bg-cyan-100 text-cyan-700",
  "Partially Dispatched": "bg-teal-100 text-teal-700",
  "Dispatched": "bg-blue-100 text-blue-700",
  "Delivered": "bg-green-100 text-green-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-600",
};

const TIMELINE_ICONS: Record<string, string> = {
  created: "bg-blue-500",
  confirmed: "bg-indigo-500",
  production_started: "bg-orange-500",
  production_running: "bg-purple-500",
  quality_check: "bg-yellow-500",
  ready_for_dispatch: "bg-cyan-500",
  dispatched: "bg-blue-500",
  delivered: "bg-green-500",
  completed: "bg-emerald-500",
  cancelled: "bg-red-500",
};

export default function OrderDetailGlobal() {
  const [, params] = useRoute("/orders/:id");
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOther, setCancelOther] = useState("");

  const { data: order, isLoading } = useQuery<any>({
    queryKey: ["order", id],
    queryFn: () => customFetch(`/orders/${id}`),
    enabled: !!id,
  });

  const { data: timeline = [] } = useQuery<any[]>({
    queryKey: ["order-timeline", id],
    queryFn: () => customFetch(`/orders/${id}/timeline`),
    enabled: !!id,
  });

  if (!id || isNaN(id)) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Invalid order ID.</p>
        <Button variant="link" onClick={() => setLocation("/orders")}>Back to Orders</Button>
      </div>
    );
  }

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!order) return <div className="p-6 text-center">Order not found</div>;

  const role = user?.role;
  const canViewProduction = role === "admin" || role === "production_and_support" || role === "production" || role === "sales";
  const canUpdateProduction = role === "admin" || role === "production" || role === "production_and_support";

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
            <Badge className={`${ORDER_STATUS_COLORS[order.status] || "bg-gray-100"}`}>{order.status}</Badge>
            {order.isRepeatOrder && <Badge className="bg-amber-100 text-amber-700">Repeat Order</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{(() => { const n = order.companyName || order.customerName || "-"; const cc = order.customerCode; return cc && !n.includes(cc) ? `${n} (${cc})` : n; })()}</p>
        </div>
      </div>

      {/* Order Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Order Date</p>
          <p className="font-medium text-sm">{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Grand Total</p>
          <p className="font-bold text-sm">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Sales Owner</p>
          <p className="font-medium text-sm">{order.salesOwner?.name || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Support Owner</p>
          <p className="font-medium text-sm">{order.supportOwner?.name || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Unit</p>
          <p className="font-medium text-sm">{order.productionUnit || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Products</p>
          <p className="font-medium text-sm">{order.items?.length || 0} items</p>
        </Card>
      </div>

      {/* Delivery & Payment Info */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Delivery & Payment</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {order.paymentTerms && <div><span className="text-muted-foreground">Payment Terms:</span> <span className="font-medium">{order.paymentTerms}</span></div>}
          {order.deliveryTerms && <div><span className="text-muted-foreground">Delivery Terms:</span> <span className="font-medium">{order.deliveryTerms}</span></div>}
          {order.freight && <div><span className="text-muted-foreground">Freight:</span> <span className="font-medium">₹{Number(order.freight).toLocaleString("en-IN")}</span></div>}
          {order.transportCompany && <div><span className="text-muted-foreground">Transport:</span> <span className="font-medium">{order.transportCompany}</span></div>}
          {order.dispatchAddress && <div className="col-span-2"><span className="text-muted-foreground">Dispatch Address:</span> <span className="font-medium">{order.dispatchAddress}</span></div>}
          {order.remarks && <div className="col-span-2"><span className="text-muted-foreground">Remarks:</span> <span className="font-medium">{order.remarks}</span></div>}
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Products ({order.items?.length || 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {order.items && order.items.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">Product Name</TableHead>
                    <TableHead className="text-xs">Bottle Weight</TableHead>
                    <TableHead className="text-xs">Color</TableHead>
                    <TableHead className="text-xs">Cap Color</TableHead>
                    <TableHead className="text-xs">Machine</TableHead>
                    <TableHead className="text-xs">HSN</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Rate</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item: any, idx: number) => (
                    <TableRow key={item.id || idx}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-xs">{item.productName}</TableCell>
                      <TableCell className="text-xs">{item.bottleWeight || "-"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          {item.colour && <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={{ backgroundColor: item.colour?.toLowerCase() }} />}
                          {item.colour || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{item.capColour || "-"}</TableCell>
                      <TableCell className="text-xs">{item.machineType || "-"}</TableCell>
                      <TableCell className="text-xs">{item.hsnCode || "-"}</TableCell>
                      <TableCell className="text-xs text-right">{Number(item.quantity || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right">₹{Number(item.rate || 0).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-xs text-right font-medium">₹{Number(item.amount || 0).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground text-sm">No items</p>
          )}
        </CardContent>
      </Card>

      {/* Production Progress (for Sales users - read only) */}
      {canViewProduction && order.dealId && (
        <ProductionProgressSection invoiceId={order.proformaInvoiceId || 0} />
      )}

      {/* Order Status Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Order Status Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-4">No timeline events</p>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
              {timeline.map((event: any, i: number) => {
                const eventKey = (event.status || "").toLowerCase().replace(/\s+/g, "_");
                const dotColor = TIMELINE_ICONS[eventKey] || "bg-gray-400";
                return (
                  <div key={event.id || i} className="flex gap-4 pb-6 relative">
                    <div className={`w-8 h-8 rounded-full ${dotColor} flex items-center justify-center text-white z-10 flex-shrink-0`}>
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-medium">{event.status || "Status Change"}</p>
                      {event.notes && <p className="text-xs text-muted-foreground mt-0.5">{event.notes}</p>}
                      <p className="text-xs text-muted-foreground">
                        {event.userName || "System"} — {new Date(event.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Select value={cancelReason} onValueChange={setCancelReason}>
                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>
                  {["Customer Cancelled", "Price Issue", "Quality Concern", "Duplicate Order", "Wrong Product", "Production Delay", "Payment Issue", "Other"].map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cancelReason === "Other" && (
              <div className="space-y-1">
                <Label>Details *</Label>
                <Textarea value={cancelOther} onChange={e => setCancelOther(e.target.value)} rows={2} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)}>Keep Order</Button>
            <Button
              variant="destructive"
              disabled={!cancelReason || (cancelReason === "Other" && !cancelOther)}
              onClick={async () => {
                try {
                  await customFetch(`/orders/${id}/cancel`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      cancellationReason: cancelReason === "Other" ? "Other" : cancelReason,
                      cancellationOtherReason: cancelReason === "Other" ? cancelOther : undefined,
                    }),
                  });
                  queryClient.invalidateQueries({ queryKey: ["order", id] });
                  queryClient.invalidateQueries({ queryKey: ["order-timeline", id] });
                } catch (e) {
                  console.error("Cancel failed", e);
                }
                setCancelDialog(false);
                setCancelReason("");
                setCancelOther("");
              }}
            >
              Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
