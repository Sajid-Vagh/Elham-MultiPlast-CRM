import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Pencil, Trash2, Truck, Package, Upload, Undo2, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";
import { useActiveUnits } from "@/lib/use-active-units";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}`, "Content-Type": "application/json" });

// ── Types ──
type TransportDest = {
  id: number; state: string; city: string; pinCode: string | null; transportCompany: string | null;
  transportType: string; transportCharge: number; transitDays: number | null;
  productionUnit: string | null; remarks: string | null; isActive: boolean;
  createdBy: number | null; updatedBy: number | null;
  createdAt: string; updatedAt: string;
};

type Bundle = {
  id: number; productName: string; productId: number | null; bundleSize: number;
  linerPackingQty: number; tciBoraQty: number; normalBoraQty: number;
  productionUnit: string | null; remarks: string | null; isActive: boolean;
  createdBy: number | null; updatedBy: number | null;
  createdAt: string; updatedAt: string;
};

type ImportBatch = {
  id: number; entityType: string; importedBy: number; fileName: string | null;
  rowCount: number; successCount: number; errorCount: number;
  report: any; undoneAt: string | null; createdAt: string;
};

type ImportPreview = {
  summary: { total: number; valid: number; invalid: number };
  errors: { row: number; field: string; message: string }[];
  validRows: any[];
  fileName: string;
};

const EMPTY_TRANSPORT_FORM = { state: "", city: "", pinCode: "", transportCompany: "", transportType: "Bundle Wise", transportCharge: "", transitDays: "", productionUnit: "all", remarks: "" };
const EMPTY_BUNDLE_FORM = { productName: "", bundleSize: "", linerPackingQty: "", tciBoraQty: "", normalBoraQty: "", productionUnit: "all", remarks: "" };

// ══════════════════════════════════════════════════════════════
// TRANSPORT MASTER TAB
// ══════════════════════════════════════════════════════════════
function TransportMasterTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { units: activeUnits } = useActiveUnits();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [unitFilter, setUnitFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<TransportDest | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_TRANSPORT_FORM);
  const [editForm, setEditForm] = useState(EMPTY_TRANSPORT_FORM);
  const [historyItem, setHistoryItem] = useState<TransportDest | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["transport-destinations", { search, page, unit: unitFilter }],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (unitFilter !== "all") p.set("unit", unitFilter);
      p.set("page", String(page));
      const res = await fetch(`/api/transport-masters/destinations?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ["transport-history", historyItem?.id],
    queryFn: async () => {
      const res = await fetch(`/api/transport-masters/destinations/history/${historyItem!.id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!historyItem,
  });

  const createMut = useMutation({
    mutationFn: async (form: typeof EMPTY_TRANSPORT_FORM) => {
      const res = await fetch("/api/transport-masters/destinations", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          state: form.state, city: form.city, pinCode: form.pinCode || undefined,
          transportCompany: form.transportCompany || undefined, transportType: form.transportType,
          transportCharge: Number(form.transportCharge || 0),
          transitDays: form.transitDays ? Number(form.transitDays) : undefined,
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-destinations"] }); toast({ title: "Transport record created" }); setCreateOpen(false); setCreateForm(EMPTY_TRANSPORT_FORM); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: typeof EMPTY_TRANSPORT_FORM }) => {
      const res = await fetch(`/api/transport-masters/destinations/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          state: form.state, city: form.city, pinCode: form.pinCode || null,
          transportCompany: form.transportCompany || null, transportType: form.transportType,
          transportCharge: Number(form.transportCharge || 0),
          transitDays: form.transitDays ? Number(form.transitDays) : null,
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || null,
        }),
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

  const toForm = (item: TransportDest) => ({
    state: item.state, city: item.city, pinCode: item.pinCode || "",
    transportCompany: item.transportCompany || "", transportType: item.transportType,
    transportCharge: String(item.transportCharge), transitDays: item.transitDays ? String(item.transitDays) : "",
    productionUnit: item.productionUnit || "all", remarks: item.remarks || "",
  });

  const renderForm = (form: typeof EMPTY_TRANSPORT_FORM, setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_TRANSPORT_FORM>>) => (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div><Label>Factory Unit *</Label>
        <Select value={form.productionUnit} onValueChange={v => setForm(p => ({ ...p, productionUnit: v }))}>
          <SelectTrigger><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label>PIN Code</Label><Input value={form.pinCode} onChange={e => setForm(p => ({ ...p, pinCode: e.target.value }))} placeholder="6-digit PIN" maxLength={6} /></div>
      <div><Label>Destination State *</Label><Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} placeholder="e.g. Maharashtra" /></div>
      <div><Label>Destination City *</Label><Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Pune" /></div>
      <div><Label>Transport Company</Label><Input value={form.transportCompany} onChange={e => setForm(p => ({ ...p, transportCompany: e.target.value }))} placeholder="e.g. TCI, VRL" /></div>
      <div><Label>Transport Type</Label>
        <Select value={form.transportType} onValueChange={v => setForm(p => ({ ...p, transportType: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Bundle Wise">Bundle Wise</SelectItem>
            <SelectItem value="Vehicle Wise">Vehicle Wise</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Freight Charge (₹) *</Label><Input type="number" min={0} step={0.01} value={form.transportCharge} onChange={e => setForm(p => ({ ...p, transportCharge: e.target.value }))} placeholder="Per bundle/vehicle" /></div>
      <div><Label>Transit Days</Label><Input type="number" min={0} value={form.transitDays} onChange={e => setForm(p => ({ ...p, transitDays: e.target.value }))} placeholder="Days" /></div>
      <div className="col-span-2"><Label>Remarks</Label><Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={2} placeholder="Optional notes" /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Factory → Destination → Transport Company → Rate</p>
        {canManage && (
          <Button size="sm" onClick={() => { setCreateForm(EMPTY_TRANSPORT_FORM); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Transport
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search PIN, city, state, company..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Select value={unitFilter} onValueChange={v => { setUnitFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Transport Co.</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Charge (₹)</TableHead>
                <TableHead className="text-right">Transit</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No transport records found</TableCell></TableRow>
              ) : (
                data?.data?.map((item: TransportDest) => (
                  <TableRow key={item.id}>
                    <TableCell><Badge variant="outline">{item.productionUnit || "All"}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{item.pinCode || "—"}</TableCell>
                    <TableCell className="font-medium">{item.city}</TableCell>
                    <TableCell>{item.state}</TableCell>
                    <TableCell>{item.transportCompany || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{item.transportType}</Badge></TableCell>
                    <TableCell className="text-right font-bold text-green-700">₹{Number(item.transportCharge).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right">{item.transitDays ? `${item.transitDays}d` : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="History" onClick={() => setHistoryItem(item)}>
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                        {canManage && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setEditForm(toForm(item)); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this transport record?")) deleteMut.mutate(item.id); }}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </>
                        )}
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
          <p className="text-sm text-muted-foreground">Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} records)</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Transport Record</DialogTitle></DialogHeader>
          {renderForm(createForm, setCreateForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={createMut.isPending || !createForm.state || !createForm.city || !createForm.transportCharge} onClick={() => createMut.mutate(createForm)}>
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={o => !o && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Transport Record</DialogTitle></DialogHeader>
          {renderForm(editForm, setEditForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={updateMut.isPending || !editForm.state || !editForm.city || !editForm.transportCharge} onClick={() => editItem && updateMut.mutate({ id: editItem.id, form: editForm })}>
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={!!historyItem} onOpenChange={o => !o && setHistoryItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change History — {historyItem?.transportCompany || historyItem?.city}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {!historyData || historyData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No changes recorded</p>
            ) : (
              historyData.map((log: any) => (
                <div key={log.id} className="p-3 bg-muted/30 rounded-md text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-xs">{log.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                  {log.oldValue && log.newValue && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {Object.keys(log.newValue).filter(k => k !== "updatedAt" && k !== "updatedBy").map(k => (
                        <div key={k}>{k}: <span className="line-through text-red-500">{String((log.oldValue as any)[k] ?? "—")}</span> → <span className="text-green-600">{String((log.newValue as any)[k] ?? "—")}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PACKING MASTER TAB
// ══════════════════════════════════════════════════════════════
function PackingMasterTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { units: activeUnits } = useActiveUnits();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [unitFilter, setUnitFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Bundle | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_BUNDLE_FORM);
  const [editForm, setEditForm] = useState(EMPTY_BUNDLE_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["product-bundles", { search, page, unit: unitFilter }],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (unitFilter !== "all") p.set("unit", unitFilter);
      p.set("page", String(page));
      const res = await fetch(`/api/transport-masters/bundles?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (form: typeof EMPTY_BUNDLE_FORM) => {
      const res = await fetch("/api/transport-masters/bundles", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          productName: form.productName,
          bundleSize: Number(form.bundleSize || form.linerPackingQty || 80),
          linerPackingQty: Number(form.linerPackingQty || 0),
          tciBoraQty: Number(form.tciBoraQty || 0),
          normalBoraQty: Number(form.normalBoraQty || 0),
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles"] }); toast({ title: "Packing record created" }); setCreateOpen(false); setCreateForm(EMPTY_BUNDLE_FORM); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: typeof EMPTY_BUNDLE_FORM }) => {
      const res = await fetch(`/api/transport-masters/bundles/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          productName: form.productName,
          bundleSize: Number(form.bundleSize || form.linerPackingQty || 80),
          linerPackingQty: Number(form.linerPackingQty || 0),
          tciBoraQty: Number(form.tciBoraQty || 0),
          normalBoraQty: Number(form.normalBoraQty || 0),
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || null,
        }),
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

  const toForm = (item: Bundle) => ({
    productName: item.productName, bundleSize: String(item.bundleSize),
    linerPackingQty: String(item.linerPackingQty), tciBoraQty: String(item.tciBoraQty),
    normalBoraQty: String(item.normalBoraQty), productionUnit: item.productionUnit || "all",
    remarks: item.remarks || "",
  });

  const renderForm = (form: typeof EMPTY_BUNDLE_FORM, setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_BUNDLE_FORM>>) => (
    <div className="grid gap-3 pt-2">
      <div><Label>Product Name *</Label><Input value={form.productName} onChange={e => setForm(p => ({ ...p, productName: e.target.value }))} placeholder="e.g. 500ml Bottle" /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Liner Packing Qty</Label><Input type="number" min={0} value={form.linerPackingQty} onChange={e => setForm(p => ({ ...p, linerPackingQty: e.target.value }))} placeholder="0" /></div>
        <div><Label>TCI Bora Qty</Label><Input type="number" min={0} value={form.tciBoraQty} onChange={e => setForm(p => ({ ...p, tciBoraQty: e.target.value }))} placeholder="0" /></div>
        <div><Label>Normal Bora Qty</Label><Input type="number" min={0} value={form.normalBoraQty} onChange={e => setForm(p => ({ ...p, normalBoraQty: e.target.value }))} placeholder="0" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Production Unit</Label>
          <Select value={form.productionUnit} onValueChange={v => setForm(p => ({ ...p, productionUnit: v }))}>
            <SelectTrigger><SelectValue placeholder="All Units" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units</SelectItem>
              {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="Optional" /></div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Packing quantities per product (Liner / TCI Bora / Normal Bora)</p>
        {canManage && (
          <Button size="sm" onClick={() => { setCreateForm(EMPTY_BUNDLE_FORM); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Packing
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search product name..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Select value={unitFilter} onValueChange={v => { setUnitFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Liner Qty</TableHead>
                <TableHead className="text-right">TCI Bora</TableHead>
                <TableHead className="text-right">Normal Bora</TableHead>
                <TableHead className="text-right">Bundle Size</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No packing records found</TableCell></TableRow>
              ) : (
                data?.data?.map((item: Bundle) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell><Badge variant="outline">{item.productionUnit || "All"}</Badge></TableCell>
                    <TableCell className="text-right">{item.linerPackingQty}</TableCell>
                    <TableCell className="text-right">{item.tciBoraQty}</TableCell>
                    <TableCell className="text-right">{item.normalBoraQty}</TableCell>
                    <TableCell className="text-right font-bold">{item.bundleSize}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canManage && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setEditForm(toForm(item)); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this packing record?")) deleteMut.mutate(item.id); }}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </>
                        )}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Packing Record</DialogTitle></DialogHeader>
          {renderForm(createForm, setCreateForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={createMut.isPending || !createForm.productName} onClick={() => createMut.mutate(createForm)}>
              {createMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={o => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Packing Record</DialogTitle></DialogHeader>
          {renderForm(editForm, setEditForm)}
          <div className="flex gap-2 pt-3">
            <Button disabled={updateMut.isPending || !editForm.productName} onClick={() => editItem && updateMut.mutate({ id: editItem.id, form: editForm })}>
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// IMPORT TAB
// ══════════════════════════════════════════════════════════════
function ImportTab({ canImport, canUndo }: { canImport: boolean; canUndo: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entityType, setEntityType] = useState<"transport_master" | "packing_master">("transport_master");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: any[] } | null>(null);

  const entityPrefix = entityType === "transport_master" ? "transport-masters/destinations" : "transport-masters/bundles";

  const { data: lastBatch, refetch: refetchLastBatch } = useQuery({
    queryKey: ["import-last", entityType],
    queryFn: async () => {
      const res = await fetch(`/api/${entityPrefix}/import/last`, { headers: authHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const res = await fetch(`/api/${entityPrefix}/import/preview`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ rows, fileName: file.name }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const result = await res.json();
      setPreview({ ...result, fileName: file.name });
      setImportResult(null);
    } catch (err: any) {
      toast({ title: err.message || "Failed to parse file", variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  }, [entityType, toast]);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/${entityPrefix}/import/execute`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ rows: preview.validRows, fileName: preview.fileName }),
      });
      if (!res.ok) throw new Error("Import failed");
      const result = await res.json();
      setImportResult(result);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["transport-destinations"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles"] });
      refetchLastBatch();
      toast({ title: `Imported ${result.imported} records` });
    } catch (err: any) {
      toast({ title: err.message || "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }, [preview, entityType, toast]);

  const handleUndo = useCallback(async () => {
    if (!confirm("Undo the last import? This will delete all records from that import.")) return;
    try {
      const res = await fetch(`/api/${entityPrefix}/import/undo`, {
        method: "POST", headers: authHeaders(),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["transport-destinations"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles"] });
      refetchLastBatch();
      toast({ title: `Undone: ${result.undone} records removed` });
    } catch (err: any) {
      toast({ title: err.message || "Undo failed", variant: "destructive" });
    }
  }, [entityType, toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div>
          <Label>Import Type</Label>
          <Select value={entityType} onValueChange={v => { setEntityType(v as any); setPreview(null); setImportResult(null); }}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="transport_master">Transport Master</SelectItem>
              <SelectItem value="packing_master">Packing Master</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canImport && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> Upload Excel
            </Button>
          </>
        )}
        {canUndo && lastBatch && !lastBatch.undoneAt && (
          <Button size="sm" variant="outline" onClick={handleUndo}>
            <Undo2 className="h-4 w-4 mr-1" /> Undo Last Import
          </Button>
        )}
      </div>

      {/* Import instructions */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-2">Expected Excel Columns:</p>
          {entityType === "transport_master" ? (
            <p className="text-xs text-muted-foreground">Factory Unit, State, City, PIN Code, Transport Company, Transport Type, Freight Charge, Transit Days, Remarks</p>
          ) : (
            <p className="text-xs text-muted-foreground">Product Name, Product ID, Liner Packing Qty, TCI Bora Qty, Normal Bora Qty, Production Unit, Remarks</p>
          )}
        </CardContent>
      </Card>

      {/* Preview Table */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Preview: {preview.fileName}
              <Badge variant="outline">{preview.summary.valid} valid</Badge>
              {preview.summary.invalid > 0 && <Badge variant="destructive">{preview.summary.invalid} errors</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Row</TableHead>
                  {entityType === "transport_master" ? (
                    <>
                      <TableHead>Unit</TableHead><TableHead>PIN</TableHead><TableHead>City</TableHead>
                      <TableHead>State</TableHead><TableHead>Company</TableHead><TableHead className="text-right">Charge</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Product</TableHead><TableHead className="text-right">Liner</TableHead>
                      <TableHead className="text-right">TCI Bora</TableHead><TableHead className="text-right">Normal Bora</TableHead>
                    </>
                  )}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.validRows.slice(0, 50).map((row: any, i: number) => {
                  const rowNum = row._rowNum || i + 1;
                  const error = preview.errors.find(e => e.row === rowNum);
                  return (
                    <TableRow key={i} className={error ? "bg-red-50" : ""}>
                      <TableCell className="text-xs">{rowNum}</TableCell>
                      {entityType === "transport_master" ? (
                        <>
                          <TableCell className="text-xs">{row.productionUnit || "All"}</TableCell>
                          <TableCell className="text-xs font-mono">{row.pinCode || "—"}</TableCell>
                          <TableCell className="text-xs">{row.city}</TableCell>
                          <TableCell className="text-xs">{row.state}</TableCell>
                          <TableCell className="text-xs">{row.transportCompany || "—"}</TableCell>
                          <TableCell className="text-xs text-right">₹{row.transportCharge || 0}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-xs">{row.productName}</TableCell>
                          <TableCell className="text-xs text-right">{row.linerPackingQty || 0}</TableCell>
                          <TableCell className="text-xs text-right">{row.tciBoraQty || 0}</TableCell>
                          <TableCell className="text-xs text-right">{row.normalBoraQty || 0}</TableCell>
                        </>
                      )}
                      <TableCell>
                        {error ? (
                          <Badge variant="destructive" className="text-xs">{error.message}</Badge>
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
          <div className="p-4 flex gap-2">
            <Button size="sm" disabled={importing || preview.summary.valid === 0} onClick={handleImport}>
              {importing ? "Importing..." : `Import ${preview.summary.valid} Records`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Import Result */}
      {importResult && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <p className="text-sm font-medium">Import Complete</p>
            </div>
            <p className="text-sm text-muted-foreground">{importResult.imported} records imported successfully.</p>
            {importResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm text-destructive font-medium">{importResult.errors.length} errors:</p>
                {importResult.errors.slice(0, 5).map((err: any, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">Row {err.row}: {err.message}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last Import Status */}
      {lastBatch && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-1">Last Import</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{lastBatch.fileName || "Unknown"}</span>
              <span>•</span>
              <span>{lastBatch.successCount} imported</span>
              {lastBatch.errorCount > 0 && <><span>•</span><span className="text-destructive">{lastBatch.errorCount} errors</span></>}
              <span>•</span>
              <span>{new Date(lastBatch.createdAt).toLocaleString()}</span>
              {lastBatch.undoneAt && <><span>•</span><Badge variant="outline" className="text-xs">Undone</Badge></>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function MastersPage() {
  const { data: user } = useGetMe();
  const [activeTab, setActiveTab] = useState("transport");

  const canManage = user?.role === "admin" || user?.role === "inventory";
  const canImport = user?.role === "admin" || user?.role === "inventory";
  const canUndo = user?.role === "admin";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Masters</h1>
        <p className="text-sm text-muted-foreground mt-1">Transport rates, packing quantities, and data import</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="transport">
            <Truck className="h-3.5 w-3.5 mr-1.5" />
            Transport Master
          </TabsTrigger>
          <TabsTrigger value="packing">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Packing Master
          </TabsTrigger>
          {canImport && (
            <TabsTrigger value="import">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Import
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="transport"><TransportMasterTab canManage={canManage} /></TabsContent>
        <TabsContent value="packing"><PackingMasterTab canManage={canManage} /></TabsContent>
        {canImport && <TabsContent value="import"><ImportTab canImport={canImport} canUndo={canUndo} /></TabsContent>}
      </Tabs>
    </div>
  );
}
