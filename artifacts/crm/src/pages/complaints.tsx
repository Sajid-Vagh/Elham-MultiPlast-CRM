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
import { Plus, Search, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Open": "bg-red-100 text-red-700", "Assigned": "bg-blue-100 text-blue-700",
  "Investigation": "bg-yellow-100 text-yellow-700", "Production Review": "bg-orange-100 text-orange-700",
  "Replacement Approved": "bg-purple-100 text-purple-700", "Replacement Running": "bg-indigo-100 text-indigo-700",
  "Replacement Dispatched": "bg-cyan-100 text-cyan-700", "Closed": "bg-green-100 text-green-700",
  "Rejected": "bg-gray-100 text-gray-500",
};

const COMPLAINT_TYPES = ["Bottle Leakage", "Bottle Weight", "Bottle Color", "Cap Fitting", "Printing Issue", "Quantity Difference", "Damage", "Dispatch Issue", "Transport Issue", "Other"];

export default function ComplaintsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [form, setForm] = useState({ contactId: "", customerName: "", productName: "", complaintType: "", description: "", priority: "Medium" });

  const { data, isLoading } = useQuery({
    queryKey: ["complaints", { search, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "All") params.set("status", statusFilter);
      const res = await fetch(`/api/complaints?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...form, contactId: Number(form.contactId) }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["complaints"] }); setShowCreateDialog(false); setForm({ contactId: "", customerName: "", productName: "", complaintType: "", description: "", priority: "Medium" }); toast({ title: "Complaint created" }); },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/complaints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["complaints"] }); toast({ title: "Status updated" }); },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Complaints</h1>
        <Button onClick={() => setShowCreateDialog(true)}><Plus className="h-4 w-4 mr-2" />New Complaint</Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search complaints..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>{["All", "Open", "Assigned", "Investigation", "Production Review", "Replacement Approved", "Replacement Running", "Replacement Dispatched", "Closed", "Rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Complaint #</TableHead><TableHead>Customer</TableHead><TableHead>Type</TableHead>
            <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              : data?.data?.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No complaints</TableCell></TableRow>
              : data?.data?.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.complaintNumber}</TableCell>
                  <TableCell>{c.customerName}</TableCell>
                  <TableCell><Badge variant="outline">{c.complaintType}</Badge></TableCell>
                  <TableCell><Badge className={c.priority === "High" ? "bg-red-100 text-red-700" : c.priority === "Urgent" ? "bg-red-200 text-red-800" : "bg-gray-100"}>{c.priority}</Badge></TableCell>
                  <TableCell><Badge className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell>
                    <Select value={c.status} onValueChange={v => updateStatus.mutate({ id: c.id, status: v })}>
                      <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{["Open", "Assigned", "Investigation", "Production Review", "Replacement Approved", "Replacement Running", "Replacement Dispatched", "Closed", "Rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Complaint</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Customer Name *</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
            <div><Label>Product Name</Label><Input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))} /></div>
            <div><Label>Complaint Type *</Label><Select value={form.complaintType} onValueChange={v => setForm(f => ({ ...f, complaintType: v }))}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{COMPLAINT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Priority</Label><Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Low", "Medium", "High", "Urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.customerName || !form.complaintType || createMutation.isPending} className="w-full">Create Complaint</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
