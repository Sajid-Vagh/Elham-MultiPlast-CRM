import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Eye, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Planned": "bg-gray-100 text-gray-700", "Material Issued": "bg-yellow-100 text-yellow-700",
  "Running": "bg-blue-100 text-blue-700", "Paused": "bg-orange-100 text-orange-700",
  "Completed": "bg-green-100 text-green-700", "QC Pending": "bg-indigo-100 text-indigo-700",
  "QC Passed": "bg-green-100 text-green-700", "QC Failed": "bg-red-100 text-red-700",
  "Ready For Dispatch": "bg-teal-100 text-teal-700", "Closed": "bg-gray-100 text-gray-500",
};

export default function Batches() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [batchForm, setBatchForm] = useState({ productName: "", totalQuantity: "", priority: "Normal", machine: "", operator: "", shift: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["batches", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/batches?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...batchForm, totalQuantity: Number(batchForm.totalQuantity) }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["batches"] }); setShowCreateDialog(false); setBatchForm({ productName: "", totalQuantity: "", priority: "Normal", machine: "", operator: "", shift: "", notes: "" }); toast({ title: "Batch created", description: d.batchNumber }); },
  });

  const { data: productDemand = [] } = useQuery({
    queryKey: ["product-demand"],
    queryFn: async () => {
      const res = await fetch("/api/batches/product-demand", { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Production Batches</h1>
        <Button onClick={() => setShowCreateDialog(true)}><Plus className="h-4 w-4 mr-2" />Create Batch</Button>
      </div>

      {/* Product Demand Aggregation */}
      {productDemand.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Product Demand (Aggregated)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Details</TableHead><TableHead>Total Demand</TableHead>
                <TableHead>Ready</TableHead><TableHead>Remaining</TableHead><TableHead>Orders</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {productDemand.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.productName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{[p.bottleType, p.bottleWeight, p.capColour, p.colour].filter(Boolean).join(" / ")}</TableCell>
                    <TableCell>{Number(p.totalDemand).toLocaleString()}</TableCell>
                    <TableCell>{Number(p.totalReady).toLocaleString()}</TableCell>
                    <TableCell className="font-medium text-orange-600">{Number(p.remaining).toLocaleString()}</TableCell>
                    <TableCell>{p.orderCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search batches..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Batch #</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead>
            <TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              : data?.data?.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No batches</TableCell></TableRow>
              : data?.data?.map((b: any) => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setLocation(`/production/batches/${b.id}`)}>
                  <TableCell className="font-medium">{b.batchNumber}</TableCell>
                  <TableCell>{b.productName}</TableCell>
                  <TableCell>{b.totalQuantity}</TableCell>
                  <TableCell><Badge className={STATUS_COLORS[b.status] || ""}>{b.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-gray-200 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${b.progress}%` }} /></div>
                      <span className="text-xs">{b.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={e => e.stopPropagation()}><Eye className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Production Batch</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Product Name *</Label><Input value={batchForm.productName} onChange={e => setBatchForm(f => ({ ...f, productName: e.target.value }))} /></div>
            <div><Label>Total Quantity *</Label><Input type="number" value={batchForm.totalQuantity} onChange={e => setBatchForm(f => ({ ...f, totalQuantity: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Priority</Label><Select value={batchForm.priority} onValueChange={v => setBatchForm(f => ({ ...f, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Low", "Normal", "High", "Urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Machine</Label><Input value={batchForm.machine} onChange={e => setBatchForm(f => ({ ...f, machine: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Operator</Label><Input value={batchForm.operator} onChange={e => setBatchForm(f => ({ ...f, operator: e.target.value }))} /></div>
              <div><Label>Shift</Label><Select value={batchForm.shift} onValueChange={v => setBatchForm(f => ({ ...f, shift: v }))}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{["Morning", "Afternoon", "Night"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!batchForm.productName || !batchForm.totalQuantity || createMutation.isPending} className="w-full">Create Batch</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
