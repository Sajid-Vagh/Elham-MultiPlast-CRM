import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Filter, Truck, Eye, Package } from "lucide-react";
import { ExportDropdown } from "@/components/export-dropdown";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700", "Vehicle Assigned": "bg-blue-100 text-blue-700",
  "Loaded": "bg-indigo-100 text-indigo-700", "Dispatched": "bg-purple-100 text-purple-700",
  "In Transit": "bg-cyan-100 text-cyan-700", "Delivered": "bg-green-100 text-green-700",
  "Delayed": "bg-orange-100 text-orange-700", "Returned": "bg-red-100 text-red-700",
  "Cancelled": "bg-red-100 text-red-700",
};

export default function DispatchPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [processDialog, setProcessDialog] = useState<any>(null);
  const [processForm, setProcessForm] = useState({ vehicleNumber: "", driverName: "", driverMobile: "", transportCompany: "", lrNumber: "", dispatchDate: "", expectedDeliveryDate: "", dispatchAddress: "", remarks: "" });
  const [builtyFile, setBuiltyFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dispatch", { search, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "All") params.set("status", statusFilter);
      const res = await fetch(`/api/dispatch?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
  });

  const processDispatch = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await fetch(`/api/dispatch/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...updates, status: "Vehicle Assigned" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      toast({ title: "Dispatch processed" });
      setProcessDialog(null);
      setBuiltyFile(null);
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/dispatch/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dispatch"] }); toast({ title: "Status updated" }); },
  });

  const uploadBuilty = useMutation({
    mutationFn: async ({ dispatchId, file }: { dispatchId: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/dispatch/${dispatchId}/builty`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Builty uploaded" }); setBuiltyFile(null); },
  });

  const handleProcessDispatch = () => {
    if (!processDialog) return;
    processDispatch.mutate({ id: processDialog.id, updates: processForm });
  };

  const getSourceLabel = (d: any) => {
    if (d.invoice) return d.invoice.invoiceNumber || "-";
    if (d.order) return d.order.orderNumber || "-";
    return "-";
  };

  const getCustomerName = (d: any) => {
    if (d.invoice) return d.invoice.customerName || "-";
    if (d.order) return d.order.customerName || "-";
    return "-";
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dispatch Management</h1>
        <ExportDropdown exportUrl="/api/exports/dispatch" filename="Dispatch" />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search dispatch..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>{["All", "Pending", "Vehicle Assigned", "Loaded", "Dispatched", "In Transit", "Delivered", "Delayed", "Returned", "Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Dispatch #</TableHead><TableHead>Invoice/Order</TableHead><TableHead>Customer</TableHead>
            <TableHead>Vehicle</TableHead><TableHead>Status</TableHead><TableHead>Dispatch Date</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              : data?.data?.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No dispatches</TableCell></TableRow>
              : data?.data?.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.dispatchNumber}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{getSourceLabel(d)}</span>
                      {d.productionOrder && <span className="text-xs text-muted-foreground">Prod #{d.productionOrder.id}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{getCustomerName(d)}</TableCell>
                  <TableCell>{d.vehicleNumber || "-"}</TableCell>
                  <TableCell><Badge className={STATUS_COLORS[d.status] || ""}>{d.status}</Badge></TableCell>
                  <TableCell>{d.dispatchDate || "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {d.status === "Pending" && (
                        <Button size="sm" variant="outline" onClick={() => {
                          setProcessDialog(d);
                          setProcessForm({
                            vehicleNumber: d.vehicleNumber || "", driverName: d.driverName || "", driverMobile: d.driverMobile || "",
                            transportCompany: d.transportCompany || "", lrNumber: d.lrNumber || "", dispatchDate: d.dispatchDate || new Date().toISOString().slice(0, 10),
                            expectedDeliveryDate: d.expectedDeliveryDate || "", dispatchAddress: d.dispatchAddress || "", remarks: d.remarks || "",
                          });
                        }}>
                          <Truck className="h-3 w-3 mr-1" />Process
                        </Button>
                      )}
                      {d.status !== "Delivered" && d.status !== "Cancelled" && d.status !== "Pending" && (
                        <Select value={d.status} onValueChange={v => updateStatus.mutate({ id: d.id, status: v })}>
                          <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{["Vehicle Assigned", "Loaded", "Dispatched", "In Transit", "Delivered", "Delayed", "Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      {/* Process Dispatch Dialog */}
      <Dialog open={!!processDialog} onOpenChange={() => setProcessDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Process Dispatch — {processDialog?.dispatchNumber}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {processDialog?.invoice && (
              <div className="text-sm bg-muted p-2 rounded">
                <span className="font-medium">Invoice:</span> {processDialog.invoice.invoiceNumber} | {processDialog.invoice.customerName}
              </div>
            )}
            {processDialog?.order && (
              <div className="text-sm bg-muted p-2 rounded">
                <span className="font-medium">Order:</span> {processDialog.order.orderNumber} | {processDialog.order.customerName}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Vehicle Number</Label><Input value={processForm.vehicleNumber} onChange={e => setProcessForm({ ...processForm, vehicleNumber: e.target.value })} /></div>
              <div><Label>Transport Company</Label><Input value={processForm.transportCompany} onChange={e => setProcessForm({ ...processForm, transportCompany: e.target.value })} /></div>
              <div><Label>Driver Name</Label><Input value={processForm.driverName} onChange={e => setProcessForm({ ...processForm, driverName: e.target.value })} /></div>
              <div><Label>Driver Mobile</Label><Input value={processForm.driverMobile} onChange={e => setProcessForm({ ...processForm, driverMobile: e.target.value })} /></div>
              <div><Label>LR Number</Label><Input value={processForm.lrNumber} onChange={e => setProcessForm({ ...processForm, lrNumber: e.target.value })} /></div>
              <div><Label>Dispatch Date</Label><Input type="date" value={processForm.dispatchDate} onChange={e => setProcessForm({ ...processForm, dispatchDate: e.target.value })} /></div>
              <div><Label>Expected Delivery</Label><Input type="date" value={processForm.expectedDeliveryDate} onChange={e => setProcessForm({ ...processForm, expectedDeliveryDate: e.target.value })} /></div>
            </div>
            <div><Label>Dispatch Address</Label><Textarea value={processForm.dispatchAddress} onChange={e => setProcessForm({ ...processForm, dispatchAddress: e.target.value })} rows={2} /></div>
            <div><Label>Remarks</Label><Textarea value={processForm.remarks} onChange={e => setProcessForm({ ...processForm, remarks: e.target.value })} rows={2} /></div>
            <div>
              <Label>Builty / Transport Receipt</Label>
              <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setBuiltyFile(e.target.files?.[0] || null)} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setProcessDialog(null)}>Cancel</Button>
              <Button onClick={handleProcessDispatch} disabled={processDispatch.isPending}>
                {processDispatch.isPending ? "Processing..." : "Assign Vehicle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
