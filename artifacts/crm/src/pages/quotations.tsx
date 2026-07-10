import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Filter, Trash2, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700", "Sent": "bg-blue-100 text-blue-700",
  "Viewed": "bg-cyan-100 text-cyan-700", "Negotiation": "bg-yellow-100 text-yellow-700",
  "Approved": "bg-green-100 text-green-700", "Rejected": "bg-red-100 text-red-700",
  "Expired": "bg-orange-100 text-orange-700", "Converted to Order": "bg-purple-100 text-purple-700",
};

export default function Quotations() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const { data, isLoading } = useQuery({
    queryKey: ["quotations", { search, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "All") params.set("status", statusFilter);
      const res = await fetch(`/api/quotations?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/quotations/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      toast({ title: "Converted to Order", description: data.order?.orderNumber });
      if (data.order) setLocation(`/orders/${data.order.id}`);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Quotations</h1>
        <Link href="/quotations/new"><Button><Plus className="h-4 w-4 mr-2" />New Quotation</Button></Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search quotations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {["All", "Draft", "Sent", "Viewed", "Negotiation", "Approved", "Rejected", "Expired", "Converted to Order"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Quotation #</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead>
            <TableHead>Total</TableHead><TableHead>Items</TableHead><TableHead>Created</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              : data?.data?.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No quotations found</TableCell></TableRow>
              : data?.data?.map((q: any) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">{q.quotationNumber}</TableCell>
                  <TableCell>{q.customerName}</TableCell>
                  <TableCell><Badge className={STATUS_COLORS[q.status] || ""}>{q.status}</Badge></TableCell>
                  <TableCell>₹{Number(q.grandTotal || 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell>{q.items?.length || 0}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(q.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell>
                    {q.status !== "Converted to Order" && (
                      <Button size="sm" variant="outline" onClick={() => convertMutation.mutate(q.id)} disabled={convertMutation.isPending}>
                        <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Convert
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
