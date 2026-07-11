import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Pencil, Trash2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";

type TL = { id: number; productName: string; destinationState: string; destinationCity: string; bundleSizeQty: number; transportCostPerBundle: number; createdAt: string; updatedAt: string };
type TLForm = { productName: string; destinationState: string; destinationCity: string; bundleSizeQty: string; transportCostPerBundle: string };

const EMPTY_FORM: TLForm = { productName: "", destinationState: "", destinationCity: "", bundleSizeQty: "", transportCostPerBundle: "" };

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}`, "Content-Type": "application/json" });

function TLFormFields({ form, setForm }: { form: TLForm; setForm: React.Dispatch<React.SetStateAction<TLForm>> }) {
  const f = (k: keyof TLForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div className="col-span-2"><Label>Product Name *</Label><Input value={form.productName} onChange={f("productName")} placeholder="e.g. 5L Can" /></div>
      <div><Label>Destination State *</Label><Input value={form.destinationState} onChange={f("destinationState")} placeholder="e.g. Maharashtra" /></div>
      <div><Label>Destination City *</Label><Input value={form.destinationCity} onChange={f("destinationCity")} placeholder="e.g. Pune" /></div>
      <div><Label>Bundle Size (pcs) *</Label><Input type="number" min={1} value={form.bundleSizeQty} onChange={f("bundleSizeQty")} placeholder="e.g. 80" /></div>
      <div><Label>Transport Cost per Bundle (₹) *</Label><Input type="number" min={0} step={0.01} value={form.transportCostPerBundle} onChange={f("transportCostPerBundle")} placeholder="e.g. 600" /></div>
    </div>
  );
}

export default function TransportLogistics() {
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<TL | null>(null);
  const [createForm, setCreateForm] = useState<TLForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<TLForm>(EMPTY_FORM);

  const isAdminOrSupport = user?.role === "admin" || user?.role === "support";

  const { data, isLoading } = useQuery({
    queryKey: ["transport-logistics", { search, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      const res = await fetch(`/api/transport-logistics?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (form: TLForm) => {
      const res = await fetch("/api/transport-logistics", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ productName: form.productName, destinationState: form.destinationState, destinationCity: form.destinationCity, bundleSizeQty: Number(form.bundleSizeQty), transportCostPerBundle: Number(form.transportCostPerBundle) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-logistics"] }); toast({ title: "Created" }); setCreateOpen(false); setCreateForm(EMPTY_FORM); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: TLForm }) => {
      const res = await fetch(`/api/transport-logistics/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ productName: form.productName, destinationState: form.destinationState, destinationCity: form.destinationCity, bundleSizeQty: Number(form.bundleSizeQty), transportCostPerBundle: Number(form.transportCostPerBundle) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-logistics"] }); toast({ title: "Updated" }); setEditItem(null); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/transport-logistics/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-logistics"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Error deleting", variant: "destructive" }),
  });

  const openEdit = useCallback((item: TL) => {
    setEditItem(item);
    setEditForm({ productName: item.productName, destinationState: item.destinationState, destinationCity: item.destinationCity, bundleSizeQty: String(item.bundleSizeQty), transportCostPerBundle: String(item.transportCostPerBundle) });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transport Logistics</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage transport costs and bundle sizes by destination</p>
        </div>
        {isAdminOrSupport && (
          <Button onClick={() => { setCreateForm(EMPTY_FORM); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Route
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by product, state, or city..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>City</TableHead>
                <TableHead className="text-right">Bundle Size (pcs)</TableHead>
                <TableHead className="text-right">Cost per Bundle (₹)</TableHead>
                {isAdminOrSupport && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No routes found</TableCell></TableRow>
              ) : (
                data?.data?.map((item: TL) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell>{item.destinationState}</TableCell>
                    <TableCell>{item.destinationCity}</TableCell>
                    <TableCell className="text-right">{item.bundleSizeQty}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(item.transportCostPerBundle).toLocaleString("en-IN")}</TableCell>
                    {isAdminOrSupport && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this route?")) deleteMut.mutate(item.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} routes)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Transport Route</DialogTitle></DialogHeader>
          <TLFormFields form={createForm} setForm={setCreateForm} />
          <div className="flex gap-2 pt-3">
            <Button disabled={createMut.isPending || !createForm.productName || !createForm.destinationState || !createForm.destinationCity || !createForm.bundleSizeQty || !createForm.transportCostPerBundle} onClick={() => createMut.mutate(createForm)}>
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={o => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Transport Route</DialogTitle></DialogHeader>
          <TLFormFields form={editForm} setForm={setEditForm} />
          <div className="flex gap-2 pt-3">
            <Button disabled={updateMut.isPending || !editForm.productName || !editForm.destinationState || !editForm.destinationCity || !editForm.bundleSizeQty || !editForm.transportCostPerBundle} onClick={() => editItem && updateMut.mutate({ id: editItem.id, form: editForm })}>
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
