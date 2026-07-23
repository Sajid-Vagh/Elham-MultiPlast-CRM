import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowLeft, Package, Truck, CheckCircle2, Upload, FileText } from "lucide-react";
import { ExportDropdown } from "@/components/export-dropdown";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

const DISPATCH_STATUS_COLORS: Record<string, string> = {
  "Pending Dispatch": "bg-amber-100 text-amber-700 border-amber-300",
  "Load Vehicle": "bg-blue-100 text-blue-700 border-blue-300",
  "Dispatch": "bg-purple-100 text-purple-700 border-purple-300",
  "Delivered": "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const DISPATCH_STATUSES = ["Pending Dispatch", "Load Vehicle", "Dispatch", "Delivered"];

export default function DispatchPage() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Load Vehicle dialog
  const [loadDialog, setLoadDialog] = useState<any>(null);
  const [loadForm, setLoadForm] = useState({
    transportName: "",
    lrNumber: "",
    dispatchRemarks: "",
  });
  const [lrFile, setLrFile] = useState<File | null>(null);

  // Dispatch confirm dialog
  const [dispatchDialog, setDispatchDialog] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dispatch-orders", search, statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("limit", "20");
      return customFetch<any>(`/production/dispatch-orders?${params.toString()}`);
    },
    enabled: !!user,
  });

  const loadVehicleMutation = useMutation({
    mutationFn: async ({ orderId, data: formData }: { orderId: number; data: typeof loadForm }) => {
      return customFetch<any>(`/production/orders/${orderId}/load-vehicle`, {
        method: "POST",
        body: JSON.stringify(formData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast({ title: "Vehicle loaded successfully" });
      setLoadDialog(null);
      setLoadForm({ transportName: "", lrNumber: "", dispatchRemarks: "" });
      setLrFile(null);
    },
    onError: (e: any) => {
      const msg = e?.data?.message || e?.message || "Failed to load vehicle";
      toast({ title: "Load Vehicle Failed", description: msg, variant: "destructive" });
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async (orderId: number) => {
      return customFetch<any>(`/production/orders/${orderId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast({ title: "Order dispatched successfully" });
      setDispatchDialog(null);
    },
    onError: (e: any) => {
      const msg = e?.data?.message || e?.message || "Failed to dispatch";
      toast({ title: "Dispatch Failed", description: msg, variant: "destructive" });
    },
  });

  const handleLoadVehicle = () => {
    if (!loadDialog) return;
    if (!loadForm.transportName.trim()) {
      toast({ title: "Transport name is required", variant: "destructive" });
      return;
    }
    if (!loadForm.lrNumber.trim()) {
      toast({ title: "LR / Builty number is required", variant: "destructive" });
      return;
    }
    loadVehicleMutation.mutate({ orderId: loadDialog.id, data: loadForm });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dispatch</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage dispatch workflow for Ready To Dispatch orders</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown exportUrl="/api/exports/dispatch" filename="Dispatch" />
          <Button variant="outline" size="sm" onClick={() => setLocation("/support/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Support Dashboard
          </Button>
        </div>
      </div>

      {/* Status Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { key: "pendingDispatch", label: "Pending Dispatch", color: "text-amber-600 bg-amber-50 border-amber-200", icon: Package },
            { key: "loadVehicle", label: "Load Vehicle", color: "text-blue-600 bg-blue-50 border-blue-200", icon: Truck },
            { key: "dispatched", label: "Dispatched", color: "text-purple-600 bg-purple-50 border-purple-200", icon: FileText },
            { key: "delivered", label: "Delivered", color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
          ].map(({ key, label, color, icon: Icon }) => (
            <Card key={key} className={`border ${color.split(" ").slice(1).join(" ")} cursor-pointer hover:shadow-md transition-all`}
              onClick={() => setStatusFilter(key === "pendingDispatch" ? "Pending Dispatch" : key === "loadVehicle" ? "Load Vehicle" : key === "dispatched" ? "Dispatch" : "Delivered")}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${color.split(" ")[0]}`}>{label}</span>
                  <Icon className={`h-3.5 w-3.5 ${color.split(" ")[0]}`} />
                </div>
                <p className="text-xl font-bold">{data.summary[key] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by customer, company, PI..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Dispatch Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {DISPATCH_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {data ? `${data.total} order${data.total !== 1 ? "s" : ""} found` : "Loading..."}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !data?.data?.length ? (
            <div className="py-12 text-center text-muted-foreground">No dispatch orders found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <TableHead className="text-xs">Order #</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Product</TableHead>
                    <TableHead className="text-xs">Qty</TableHead>
                    <TableHead className="text-xs">Production Status</TableHead>
                    <TableHead className="text-xs">Dispatch Status</TableHead>
                    <TableHead className="text-xs">Transport</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </tr>
                </thead>
                <TableBody>
                  {data.data.map((order: any) => (
                    <TableRow key={order.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium cursor-pointer" onClick={() => setLocation(`/production/orders/${order.id}`)}>
                        #{order.id}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{order.invoice?.customerName || "-"}</p>
                          <p className="text-xs text-muted-foreground">{order.invoice?.companyName || ""}</p>
                        </div>
                      </TableCell>
                      <TableCell>{order.items?.[0]?.productName || "-"}</TableCell>
                      <TableCell>{order.items?.[0]?.quantity ?? "-"} {order.items?.[0]?.unit || ""}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] border">
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] border ${DISPATCH_STATUS_COLORS[order.dispatchStatus] || ""}`}>
                          {order.dispatchStatus || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.transportName || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {order.dispatchStatus === "Pending Dispatch" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => {
                                setLoadDialog(order);
                                setLoadForm({
                                  transportName: order.transportName || "",
                                  lrNumber: order.lrNumber || "",
                                  dispatchRemarks: order.dispatchRemarks || "",
                                });
                              }}>
                              <Truck className="h-3 w-3 mr-1" /> Load Vehicle
                            </Button>
                          )}
                          {order.dispatchStatus === "Load Vehicle" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setDispatchDialog(order)}>
                              <Package className="h-3 w-3 mr-1" /> Dispatch
                            </Button>
                          )}
                          {order.dispatchStatus === "Dispatch" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setLocation(`/production/orders/${order.id}`)}>
                              Mark Delivered
                            </Button>
                          )}
                          {order.dispatchStatus === "Delivered" && (
                            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              Completed
                            </Badge>
                          )}
                          {!order.dispatchStatus && order.status === "Ready To Dispatch" && (
                            <span className="text-xs text-muted-foreground">Waiting</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Load Vehicle Dialog */}
      <Dialog open={!!loadDialog} onOpenChange={() => setLoadDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Load Vehicle — Order #{loadDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {loadDialog && (
              <div className="text-sm bg-muted p-3 rounded-lg">
                <p className="font-medium">{loadDialog.invoice?.customerName || "Customer"}</p>
                <p className="text-xs text-muted-foreground">{loadDialog.invoice?.companyName || ""}</p>
                <p className="text-xs text-muted-foreground mt-1">Product: {loadDialog.items?.[0]?.productName} ({loadDialog.items?.[0]?.quantity} {loadDialog.items?.[0]?.unit})</p>
              </div>
            )}
            <div>
              <Label>Transport Name *</Label>
              <Input value={loadForm.transportName} onChange={e => setLoadForm({ ...loadForm, transportName: e.target.value })}
                placeholder="e.g. ABC Transport" className="mt-1" />
            </div>
            <div>
              <Label>LR / Builty Number</Label>
              <Input value={loadForm.lrNumber} onChange={e => setLoadForm({ ...loadForm, lrNumber: e.target.value })}
                placeholder="e.g. LR-12345" className="mt-1" />
            </div>
            <div>
              <Label>Upload LR / Builty</Label>
              <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setLrFile(e.target.files?.[0] || null)} className="mt-1" />
              {lrFile && <p className="text-xs text-muted-foreground mt-1">{lrFile.name}</p>}
            </div>
            <div>
              <Label>Dispatch Remarks</Label>
              <Textarea value={loadForm.dispatchRemarks} onChange={e => setLoadForm({ ...loadForm, dispatchRemarks: e.target.value })}
                placeholder="Any notes about this dispatch..." rows={2} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setLoadDialog(null)}>Cancel</Button>
              <Button onClick={handleLoadVehicle} disabled={loadVehicleMutation.isPending}>
                {loadVehicleMutation.isPending ? "Saving..." : "Load Vehicle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dispatch Confirm Dialog */}
      <Dialog open={!!dispatchDialog} onOpenChange={() => setDispatchDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Dispatch</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Mark order <strong>#{dispatchDialog?.id}</strong> as dispatched? This will update the status to <strong>Dispatch</strong>.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDispatchDialog(null)}>Cancel</Button>
            <Button onClick={() => dispatchDialog && dispatchMutation.mutate(dispatchDialog.id)} disabled={dispatchMutation.isPending}>
              {dispatchMutation.isPending ? "Dispatching..." : "Confirm Dispatch"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
