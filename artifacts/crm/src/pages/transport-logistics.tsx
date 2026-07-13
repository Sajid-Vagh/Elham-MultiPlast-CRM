import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Pencil, Trash2, Package, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}`, "Content-Type": "application/json" });

type Bundle = { id: number; productName: string; bundleSize: number; isActive: boolean; createdAt: string; updatedAt: string };
type BundleForm = { productName: string; bundleSize: string };
const EMPTY_BUNDLE_FORM: BundleForm = { productName: "", bundleSize: "" };

type Destination = { id: number; state: string; city: string; transportType: string; transportCharge: number; isActive: boolean; createdAt: string; updatedAt: string };
type DestinationForm = { state: string; city: string; transportType: string; transportCharge: string };
const EMPTY_DEST_FORM: DestinationForm = { state: "", city: "", transportType: "Bundle Wise", transportCharge: "" };

function BundleMasterTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Bundle | null>(null);
  const [createForm, setCreateForm] = useState<BundleForm>(EMPTY_BUNDLE_FORM);
  const [editForm, setEditForm] = useState<BundleForm>(EMPTY_BUNDLE_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["product-bundles", { search, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      const res = await fetch(`/api/transport-masters/bundles?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (form: BundleForm) => {
      const res = await fetch("/api/transport-masters/bundles", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ productName: form.productName, bundleSize: Number(form.bundleSize) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles"] }); toast({ title: "Bundle created" }); setCreateOpen(false); setCreateForm(EMPTY_BUNDLE_FORM); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: BundleForm }) => {
      const res = await fetch(`/api/transport-masters/bundles/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ productName: form.productName, bundleSize: Number(form.bundleSize) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles"] }); toast({ title: "Updated" }); setEditItem(null); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/transport-masters/bundles/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Error deleting", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage product bundle sizes (pcs per bundle)</p>
        <Button size="sm" onClick={() => { setCreateForm(EMPTY_BUNDLE_FORM); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Bundle
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by product name..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Bundle Size (pcs)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No product bundles found</TableCell></TableRow>
              ) : (
                data?.data?.map((item: Bundle) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-right font-bold">{item.bundleSize} pcs</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={item.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setEditForm({ productName: item.productName, bundleSize: String(item.bundleSize) }); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this bundle?")) deleteMut.mutate(item.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.pagination.page} of {data.pagination.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Product Bundle</DialogTitle></DialogHeader>
          <div className="grid gap-3 pt-2">
            <div><Label>Product Name *</Label><Input value={createForm.productName} onChange={e => setCreateForm(p => ({ ...p, productName: e.target.value }))} placeholder="e.g. 5L Can" /></div>
            <div><Label>Bundle Size (pcs) *</Label><Input type="number" min={1} value={createForm.bundleSize} onChange={e => setCreateForm(p => ({ ...p, bundleSize: e.target.value }))} placeholder="e.g. 80" /></div>
          </div>
          <div className="flex gap-2 pt-3">
            <Button disabled={createMut.isPending || !createForm.productName || !createForm.bundleSize} onClick={() => createMut.mutate(createForm)}>
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={o => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Product Bundle</DialogTitle></DialogHeader>
          <div className="grid gap-3 pt-2">
            <div><Label>Product Name *</Label><Input value={editForm.productName} onChange={e => setEditForm(p => ({ ...p, productName: e.target.value }))} /></div>
            <div><Label>Bundle Size (pcs) *</Label><Input type="number" min={1} value={editForm.bundleSize} onChange={e => setEditForm(p => ({ ...p, bundleSize: e.target.value }))} /></div>
          </div>
          <div className="flex gap-2 pt-3">
            <Button disabled={updateMut.isPending || !editForm.productName || !editForm.bundleSize} onClick={() => editItem && updateMut.mutate({ id: editItem.id, form: editForm })}>
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DestinationMasterTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Destination | null>(null);
  const [createForm, setCreateForm] = useState<DestinationForm>(EMPTY_DEST_FORM);
  const [editForm, setEditForm] = useState<DestinationForm>(EMPTY_DEST_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["transport-destinations", { search, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      const res = await fetch(`/api/transport-masters/destinations?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (form: DestinationForm) => {
      const res = await fetch("/api/transport-masters/destinations", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ state: form.state, city: form.city, transportType: form.transportType, transportCharge: Number(form.transportCharge) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-destinations"] }); toast({ title: "Destination created" }); setCreateOpen(false); setCreateForm(EMPTY_DEST_FORM); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: DestinationForm }) => {
      const res = await fetch(`/api/transport-masters/destinations/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ state: form.state, city: form.city, transportType: form.transportType, transportCharge: Number(form.transportCharge) }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-destinations"] }); toast({ title: "Updated" }); setEditItem(null); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/transport-masters/destinations/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-destinations"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Error deleting", variant: "destructive" }),
  });

  const renderDestForm = (form: DestinationForm, setForm: React.Dispatch<React.SetStateAction<DestinationForm>>) => (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div><Label>State *</Label><Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} placeholder="e.g. Gujarat" /></div>
      <div><Label>City *</Label><Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Ahmedabad" /></div>
      <div>
        <Label>Transport Type *</Label>
        <Select value={form.transportType} onValueChange={v => setForm(p => ({ ...p, transportType: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Bundle Wise">Bundle Wise</SelectItem>
            <SelectItem value="Vehicle Wise">Vehicle Wise</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Transport Charge (₹) *</Label><Input type="number" min={0} step={0.01} value={form.transportCharge} onChange={e => setForm(p => ({ ...p, transportCharge: e.target.value }))} placeholder={form.transportType === "Vehicle Wise" ? "Vehicle charge" : "Per bundle cost"} /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage transport destinations and charges</p>
        <Button size="sm" onClick={() => { setCreateForm(EMPTY_DEST_FORM); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Destination
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by state or city..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Transport Type</TableHead>
                <TableHead className="text-right">Charge (₹)</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No destinations found</TableCell></TableRow>
              ) : (
                data?.data?.map((item: Destination) => (
                  <TableRow key={item.id}>
                    <TableCell><Badge variant="outline">{item.state}</Badge></TableCell>
                    <TableCell className="font-medium">{item.city}</TableCell>
                    <TableCell>{item.transportType}</TableCell>
                    <TableCell className="text-right font-bold">₹{Number(item.transportCharge).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setEditForm({ state: item.state, city: item.city, transportType: item.transportType, transportCharge: String(item.transportCharge) }); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this destination?")) deleteMut.mutate(item.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.pagination.page} of {data.pagination.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Transport Destination</DialogTitle></DialogHeader>
          {renderDestForm(createForm, setCreateForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={createMut.isPending || !createForm.state || !createForm.city || !createForm.transportCharge} onClick={() => createMut.mutate(createForm)}>
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={o => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Transport Destination</DialogTitle></DialogHeader>
          {renderDestForm(editForm, setEditForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={updateMut.isPending || !editForm.state || !editForm.city || !editForm.transportCharge} onClick={() => editItem && updateMut.mutate({ id: editItem.id, form: editForm })}>
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TransportLogistics() {
  const { data: user } = useGetMe();
  const [activeTab, setActiveTab] = useState<"bundles" | "destinations">("bundles");
  const isAdminOrSupport = user?.role === "admin" || user?.role === "support";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transport Logistics</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage product bundles, transport destinations, and costs</p>
      </div>

      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "bundles" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("bundles")}
        >
          <Package className="h-4 w-4 mr-1.5 inline" />
          Product Bundles
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "destinations" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("destinations")}
        >
          <MapPin className="h-4 w-4 mr-1.5 inline" />
          Transport Destinations
        </button>
      </div>

      {activeTab === "bundles" ? <BundleMasterTab /> : <DestinationMasterTab />}
    </div>
  );
}
