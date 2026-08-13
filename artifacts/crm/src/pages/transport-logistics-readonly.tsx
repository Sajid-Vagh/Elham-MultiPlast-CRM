import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, MapPin, Package, Truck, Star, Plus, Upload, CheckCircle, FileSpreadsheet, AlertTriangle, Trash2, Pencil } from "lucide-react";
import { useActiveUnits } from "@/lib/use-active-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}`, "Content-Type": "application/json" });

// Roles allowed to add / edit records & upload sheets (Admin, Support, Production & Support). Sales/Production is view-only.
const EDIT_ROLES = ["admin", "support", "production_and_support"];

// Roles allowed to delete records / clear all (Admin, Support, Production & Support).
const DELETE_ROLES = ["admin", "support", "production_and_support"];

// ── Add Record form types ──
type TransportForm = { state: string; city: string; pinCode: string; transportCompany: string; tciBora: string; normalBora: string; productionUnit: string; remarks: string };
const EMPTY_TRANSPORT_FORM: TransportForm = { state: "", city: "", pinCode: "", transportCompany: "", tciBora: "", normalBora: "", productionUnit: "all", remarks: "" };

type BundleForm = { productName: string; bundleSize: string; linerPackingQty: string; bora: string; productionUnit: string; remarks: string };
const EMPTY_BUNDLE_FORM: BundleForm = { productName: "", bundleSize: "", linerPackingQty: "", bora: "", productionUnit: "all", remarks: "" };

// ── Import parser detection (flexible column mapping) ──
type DetectedParser = "transport" | "liner" | "bora";

type ImportPreview = {
  parser: DetectedParser;
  fileName: string;
  summary: { total: number; valid: number; invalid: number };
  errors: { row: number; field: string; message: string }[];
  warnings: { row?: number; field?: string; message: string }[];
  validRows: any[];
};

const PARSER_LABELS: Record<DetectedParser, string> = { transport: "Transport Master", liner: "Liner Packing", bora: "Bora Packing" };

function formatRate(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : `₹${n.toLocaleString("en-IN")}`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function norm(h: string): string {
  return h.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function hasCol(headers: string[], ...aliases: string[]): string | undefined {
  for (const h of headers) {
    const n = norm(h);
    for (const a of aliases) { if (n === a || n.includes(a)) return h; }
  }
  return undefined;
}

const TRANSPORT_ALIASES: Record<string, string[]> = {
  state: ["state", "destination state", "dest state"],
  city: ["city", "destination city", "dest city", "town", "place"],
  pinCode: ["pin code", "pincode", "pin", "zip code", "zip", "postal code"],
  transportCompany: ["transport company", "transport co", "transporter", "company", "carrier", "transport name", "transport"],
  tciBora: ["tci bora", "tci", "tci bora rate", "tci rate"],
  normalBora: ["normal bora", "normal", "normal bora rate", "bora rate", "bora"],
  productionUnit: ["production unit", "factory unit", "unit"],
  remarks: ["remarks", "notes", "comments"],
};

const LINER_ALIASES: Record<string, string[]> = {
  productName: ["product name", "product", "item", "item name", "description"],
  linerPackingQty: ["liner packing qty", "liner packing", "liner qty", "liner", "packing qty"],
  productionUnit: ["production unit", "factory unit", "unit"],
  bundleSize: ["bundle size", "bundle", "pack size", "pack"],
};

const BORA_ALIASES: Record<string, string[]> = {
  productName: ["product name", "product", "item", "item name", "description"],
  bora: ["bora qty", "bora quantity", "bora", "normal bora qty", "normal bora", "normal"],
  bundleSize: ["bundle size", "bundle", "pack size", "pack"],
  productionUnit: ["production unit", "factory unit", "unit"],
  linerPackingQty: ["liner packing qty", "liner packing", "liner qty", "liner"],
};

function detectParser(headers: string[]): DetectedParser {
  const joined = headers.map(norm).join(" ");
  // Transport rate sheets carry STATE + CITY (+ TRANSPORT COMPANY, TCI/NORMAL BORA).
  // Check for state/city/transport markers BEFORE the bora check — a transport
  // sheet also contains "tci bora"/"normal bora" columns which would otherwise
  // be misdetected as a bora packing sheet.
  if (/state/.test(joined) && /city/.test(joined)) return "transport";
  if (/transport/.test(joined) || /freight/.test(joined) || /transit/.test(joined)) return "transport";
  if (/liner/.test(joined) && !/tci|bora|normal/.test(joined)) return "liner";
  if (/\btci\b/.test(joined) || /normal.*bora/.test(joined) || /bora/.test(joined)) return "bora";
  return "transport";
}

function mapRow(row: any, headers: string[], aliases: Record<string, string[]>): any {
  const result: any = {};
  for (const [field, aliasList] of Object.entries(aliases)) {
    const h = hasCol(headers, ...aliasList);
    if (h) result[field] = row[h];
  }
  return result;
}

function parseRows(rawRows: any[], parser: DetectedParser): { mapped: any[]; mapping: Record<string, string> } {
  if (rawRows.length === 0) return { mapped: [], mapping: {} };
  const headers = Object.keys(rawRows[0]);
  const aliases = parser === "transport" ? TRANSPORT_ALIASES : parser === "liner" ? LINER_ALIASES : BORA_ALIASES;
  const mapping: Record<string, string> = {};
  for (const [field, aliasList] of Object.entries(aliases)) {
    const h = hasCol(headers, ...aliasList);
    if (h) mapping[field] = h;
  }
  const mapped = rawRows.map((row, i) => ({ ...mapRow(row, headers, aliases), _rowNum: i + 1 }));
  return { mapped, mapping };
}

function previewEndpoint(p: DetectedParser): string {
  if (p === "transport") return "/api/transport-masters/destinations/import/preview";
  if (p === "liner") return "/api/transport-masters/bundles/import/liner/preview";
  return "/api/transport-masters/bundles/import/bora/preview";
}

function executeEndpoint(p: DetectedParser): string {
  if (p === "transport") return "/api/transport-rates/upload";
  if (p === "liner") return "/api/transport-masters/bundles/import/liner/execute";
  return "/api/transport-masters/bundles/import/bora/execute";
}

export default function TransportLogisticsLookup() {
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [pinCode, setPinCode] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [activeTab, setActiveTab] = useState("lookup");
  const [globalUnit, setGlobalUnit] = useUnitFilter();
  const unitFilter = globalUnit === "All" ? "all" : globalUnit;
  const setUnitFilter = (v: string) => setGlobalUnit(v === "all" ? "All" : v);
  const { units: activeUnits } = useActiveUnits();

  const canEdit = EDIT_ROLES.includes(user?.role || "");
  const canDelete = DELETE_ROLES.includes(user?.role || "");

  // Add / Edit Record state
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [transportForm, setTransportForm] = useState<TransportForm>(EMPTY_TRANSPORT_FORM);
  const [bundleForm, setBundleForm] = useState<BundleForm>(EMPTY_BUNDLE_FORM);

  // Import state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadUnit, setUploadUnit] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [importUnit, setImportUnit] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  // PIN-first lookup
  const { data: lookupData, isLoading: lookupLoading } = useQuery({
    queryKey: ["transport-lookup", { pinCode, city, state, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (pinCode) params.set("pinCode", pinCode);
      if (city) params.set("city", city);
      if (state) params.set("state", state);
      if (unitFilter !== "all") params.set("productionUnit", unitFilter);
      const res = await fetch(`/api/transport-masters/destinations/lookup?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: true,
  });

  // Bundle data for packing tab (debounced search + strict unit filter)
  const { data: bundleData, isLoading: bundleLoading } = useQuery({
    queryKey: ["product-bundles-lookup", { search: debouncedSearch, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (unitFilter !== "all") {
        params.set("unit", unitFilter);
        params.set("strict", "true");
      }
      params.set("limit", "100");
      const res = await fetch(`/api/transport-masters/bundles?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "packing",
  });

  const handleSearch = useCallback(() => {
    // Trigger lookup based on whichever field has data
  }, []);

  const deleteTransportMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/transport-masters/destinations/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return id;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-lookup"] }); toast({ title: "Transport record deleted" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const deleteBundleMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/transport-masters/bundles/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return id;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] }); toast({ title: "Packing record deleted" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const clearAllMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/transport-masters/clear-all", { method: "DELETE", headers: authHeaders() });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["transport-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] });
      const d = data?.deleted || {};
      toast({ title: `Cleared ${d.destinations || 0} transport & ${d.bundles || 0} packing records` });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const confirmClearAll = useCallback(() => {
    if (window.confirm("Are you sure you want to delete all freight and packing records? This cannot be undone.")) {
      clearAllMut.mutate();
    }
  }, [clearAllMut]);

  const openAdd = useCallback(() => {
    setTransportForm({ ...EMPTY_TRANSPORT_FORM, productionUnit: unitFilter });
    setBundleForm({ ...EMPTY_BUNDLE_FORM, productionUnit: unitFilter });
    setEditingId(null);
    setAddOpen(true);
  }, [unitFilter]);

  const openEditTransport = useCallback((item: any) => {
    setTransportForm({
      state: item.state || "",
      city: item.city || "",
      pinCode: item.pinCode || "",
      transportCompany: item.transportCompany || "",
      tciBora: item.tciBora != null && item.tciBora !== "" ? String(item.tciBora) : "",
      normalBora: item.normalBora != null && item.normalBora !== "" ? String(item.normalBora) : "",
      productionUnit: item.productionUnit || "all",
      remarks: item.remarks || "",
    });
    setEditingId(item.id);
    setAddOpen(true);
  }, []);

  const openEditBundle = useCallback((item: any) => {
    setBundleForm({
      productName: item.productName || "",
      bundleSize: item.bundleSize != null ? String(item.bundleSize) : "",
      linerPackingQty: (item.linerPacking ?? item.linerPackingQty) != null ? String(item.linerPacking ?? item.linerPackingQty) : "",
      bora: item.bora != null ? String(item.bora) : "",
      productionUnit: item.productionUnit || "all",
      remarks: item.remarks || "",
    });
    setEditingId(item.id);
    setAddOpen(true);
  }, []);

  const createTransportMut = useMutation({
    mutationFn: async (form: TransportForm) => {
      const res = await fetch("/api/transport-masters/destinations", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          state: form.state, city: form.city, pinCode: form.pinCode || undefined,
          transportCompany: form.transportCompany || undefined,
          tciBora: form.tciBora !== "" ? Number(form.tciBora) : 0,
          normalBora: form.normalBora !== "" ? Number(form.normalBora) : 0,
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transport-lookup"] }); toast({ title: "Transport record added" }); setAddOpen(false); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const createBundleMut = useMutation({
    mutationFn: async (form: BundleForm) => {
      const res = await fetch("/api/transport-masters/bundles", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          productName: form.productName,
          bundleSize: Number(form.bundleSize || form.linerPackingQty || 80),
          linerPackingQty: Number(form.linerPackingQty || 0),
          bora: Number(form.bora || 0),
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] }); toast({ title: "Packing record added" }); setAddOpen(false); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateTransportMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: TransportForm }) => {
      const res = await fetch(`/api/transport-masters/destinations/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          state: form.state, city: form.city, pinCode: form.pinCode || undefined,
          transportCompany: form.transportCompany || undefined,
          tciBora: form.tciBora !== "" ? Number(form.tciBora) : 0,
          normalBora: form.normalBora !== "" ? Number(form.normalBora) : 0,
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] });
      toast({ title: "Transport record updated" });
      setAddOpen(false);
      setEditingId(null);
      setTransportForm(EMPTY_TRANSPORT_FORM);
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const updateBundleMut = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: BundleForm }) => {
      const res = await fetch(`/api/transport-masters/bundles/${id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          productName: form.productName,
          bundleSize: Number(form.bundleSize || form.linerPackingQty || 80),
          linerPackingQty: Number(form.linerPackingQty || 0),
          bora: Number(form.bora || 0),
          productionUnit: form.productionUnit === "all" ? null : form.productionUnit,
          remarks: form.remarks || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] });
      toast({ title: "Packing record updated" });
      setAddOpen(false);
      setEditingId(null);
      setBundleForm(EMPTY_BUNDLE_FORM);
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const handleUploadContinue = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadUnit) return;
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (rawRows.length === 0) { toast({ title: "No data found in file", variant: "destructive" }); return; }

      const headers = Object.keys(rawRows[0] as object);
      const parser = detectParser(headers);
      const { mapped } = parseRows(rawRows, parser);

      const res = await fetch(previewEndpoint(parser), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ rows: mapped, fileName: file.name }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Preview failed"); }
      const result = await res.json();
      setImportUnit(uploadUnit);
      setPreview({ parser, fileName: file.name, summary: result.summary, errors: result.errors, warnings: result.warnings || [], validRows: result.validRows || [] });
      toast({ title: `Detected: ${PARSER_LABELS[parser]}` });
      setUploadOpen(false);
      setUploadUnit("");
      setSelectedFile("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      toast({ title: err.message || "Failed to parse file", variant: "destructive" });
    }
  }, [uploadUnit, toast]);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch(executeEndpoint(preview.parser), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          rows: preview.validRows,
          fileName: preview.fileName,
          productionUnit: importUnit,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Import failed"); }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["transport-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] });
      toast({ title: `Imported ${result.imported} ${PARSER_LABELS[preview.parser]} record(s) for ${importUnit}` });
      setPreview(null);
      setImportUnit("");
    } catch (err: any) {
      toast({ title: err.message || "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }, [preview, importUnit, toast, queryClient]);

  const renderUnitOptions = (includeAll: boolean) => (
    <>
      {includeAll && <SelectItem value="all">All Units</SelectItem>}
      {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
    </>
  );

  const renderTransportForm = (form: TransportForm, setForm: React.Dispatch<React.SetStateAction<TransportForm>>) => (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div>
        <Label>Factory Unit</Label>
        <Select value={form.productionUnit} onValueChange={v => setForm(p => ({ ...p, productionUnit: v }))}>
          <SelectTrigger><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>{renderUnitOptions(true)}</SelectContent>
        </Select>
      </div>
      <div><Label>PIN Code</Label><Input value={form.pinCode} onChange={e => setForm(p => ({ ...p, pinCode: e.target.value }))} placeholder="6-digit PIN" maxLength={6} /></div>
      <div><Label>Destination State *</Label><Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} placeholder="e.g. Maharashtra" /></div>
      <div><Label>Destination City *</Label><Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Pune" /></div>
      <div><Label>Transport Company</Label><Input value={form.transportCompany} onChange={e => setForm(p => ({ ...p, transportCompany: e.target.value }))} placeholder="e.g. TCI, VRL" /></div>
      <div><Label>TCI Bora (₹)</Label><Input type="number" min={0} step={0.01} value={form.tciBora} onChange={e => setForm(p => ({ ...p, tciBora: e.target.value }))} placeholder="TCI transport rate" /></div>
      <div><Label>Normal Bora (₹)</Label><Input type="number" min={0} step={0.01} value={form.normalBora} onChange={e => setForm(p => ({ ...p, normalBora: e.target.value }))} placeholder="Normal transport rate" /></div>
      <div className="col-span-2"><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="Optional notes" /></div>
    </div>
  );

  const renderBundleForm = (form: BundleForm, setForm: React.Dispatch<React.SetStateAction<BundleForm>>) => (
    <div className="grid gap-3 pt-2">
      <div><Label>Product Name *</Label><Input value={form.productName} onChange={e => setForm(p => ({ ...p, productName: e.target.value }))} placeholder="e.g. 500ml Bottle" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Liner Packing Qty</Label><Input type="number" min={0} value={form.linerPackingQty} onChange={e => setForm(p => ({ ...p, linerPackingQty: e.target.value }))} placeholder="0" /></div>
        <div><Label>Bora Qty</Label><Input type="number" min={0} value={form.bora} onChange={e => setForm(p => ({ ...p, bora: e.target.value }))} placeholder="0" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Production Unit</Label>
          <Select value={form.productionUnit} onValueChange={v => setForm(p => ({ ...p, productionUnit: v }))}>
            <SelectTrigger><SelectValue placeholder="All Units" /></SelectTrigger>
            <SelectContent>{renderUnitOptions(true)}</SelectContent>
          </Select>
        </div>
        <div><Label>Bundle Size (pcs)</Label><Input type="number" min={1} value={form.bundleSize} onChange={e => setForm(p => ({ ...p, bundleSize: e.target.value }))} placeholder="e.g. 80" /></div>
      </div>
      <div><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="Optional notes" /></div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Freight & Packing Lookup</h1>
        <p className="text-sm text-muted-foreground mt-1">Search transport rates by PIN code or destination, and view packing quantities</p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>{renderUnitOptions(true)}</SelectContent>
        </Select>

        <ClearFiltersButton onClear={() => { setSearch(""); setPinCode(""); setCity(""); setState(""); }} />

        {canEdit && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-1" /> Upload Sheet
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" /> Add Record
            </Button>
          </div>
        )}
        {canDelete && (
          <Button size="sm" variant="destructive" disabled={clearAllMut.isPending} onClick={confirmClearAll}>
            <Trash2 className="h-4 w-4 mr-1" /> {clearAllMut.isPending ? "Clearing..." : "Clear All Records"}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="lookup">
            <Truck className="h-3.5 w-3.5 mr-1.5" />
            Transport Rates
          </TabsTrigger>
          <TabsTrigger value="packing">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Packing Quantities
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="space-y-4">
          {/* PIN-first search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Search by PIN Code (Priority) or Destination</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">PIN Code (Highest Priority)</label>
                  <Input
                    placeholder="6-digit PIN"
                    value={pinCode}
                    onChange={e => setPinCode(e.target.value)}
                    maxLength={6}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">City (Fallback)</label>
                  <Input placeholder="e.g. Pune" value={city} onChange={e => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">State (Last Resort)</label>
                  <Input placeholder="e.g. Maharashtra" value={state} onChange={e => setState(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Badge variant="outline" className="text-xs h-9 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {lookupData?.matchedBy ? `Matched by ${lookupData.matchedBy}` : "Enter PIN or city"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>PIN Code</TableHead>
                    <TableHead>Transport Company</TableHead>
                    <TableHead className="text-right">TCI Bora (₹)</TableHead>
                    <TableHead className="text-right">Normal Bora (₹)</TableHead>
                    {(canEdit || canDelete) && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookupLoading ? (
                    <TableRow><TableCell colSpan={(canEdit || canDelete) ? 7 : 6} className="text-center py-8">Searching...</TableCell></TableRow>
                  ) : !lookupData?.data?.length ? (
                    <TableRow><TableCell colSpan={(canEdit || canDelete) ? 7 : 6} className="text-center py-8 text-muted-foreground">
                      {pinCode || city || state ? "No transport routes found for this destination" : "No transport records found"}
                    </TableCell></TableRow>
                  ) : (
                    lookupData.data.map((item: any, idx: number) => (
                      <TableRow key={item.id} className={idx === 0 ? "bg-green-50" : ""}>
                        <TableCell className="font-medium">{item.state}</TableCell>
                        <TableCell>{item.city}</TableCell>
                        <TableCell className="font-mono text-sm">{item.pinCode || "—"}</TableCell>
                        <TableCell className="font-medium">
                          {item.transportCompany || "—"}
                          {idx === 0 && <Star className="h-3 w-3 text-amber-500 ml-1 inline" />}
                        </TableCell>
                        <TableCell className="text-right font-bold text-green-700">{formatRate(item.tciBora)}</TableCell>
                        <TableCell className="text-right font-bold">{formatRate(item.normalBora)}</TableCell>
                        {(canEdit || canDelete) && (
                          <TableCell className="text-right whitespace-nowrap">
                            {canEdit && (
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8"
                                disabled={updateTransportMut.isPending}
                                onClick={() => openEditTransport(item)}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
                                disabled={deleteTransportMut.isPending}
                                onClick={() => window.confirm(`Delete transport record for ${item.city}, ${item.state}?`) && deleteTransportMut.mutate(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packing" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by product name..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="text-right">Bora</TableHead>
                    <TableHead className="text-right">Liner Packing</TableHead>
                    {(canEdit || canDelete) && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundleLoading ? (
                    <TableRow><TableCell colSpan={(canEdit || canDelete) ? 4 : 3} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : bundleData?.data?.length === 0 ? (
                    <TableRow><TableCell colSpan={(canEdit || canDelete) ? 4 : 3} className="text-center py-8 text-muted-foreground">
                      {debouncedSearch ? "No products found" : "No packing records found"}
                    </TableCell></TableRow>
                  ) : (
                    bundleData?.data?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.bora ?? "—"}</TableCell>
                        <TableCell className="text-right font-bold">{item.linerPacking ?? item.linerPackingQty ?? "—"}</TableCell>
                        {(canEdit || canDelete) && (
                          <TableCell className="text-right whitespace-nowrap">
                            {canEdit && (
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8"
                                disabled={updateBundleMut.isPending}
                                onClick={() => openEditBundle(item)}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
                                disabled={deleteBundleMut.isPending}
                                onClick={() => window.confirm(`Delete packing record for ${item.productName}?`) && deleteBundleMut.mutate(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add / Edit Record Dialog */}
      <Dialog open={addOpen} onOpenChange={o => { setAddOpen(o); if (!o) setEditingId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{activeTab === "lookup" ? (editingId ? "Edit Transport Record" : "Add Transport Record") : (editingId ? "Edit Packing Record" : "Add Packing Record")}</DialogTitle>
            <DialogDescription>
              {editingId
                ? `Editing record #${editingId}`
                : unitFilter !== "all" ? `New record will be tagged to unit: ${unitFilter}` : "Select a unit from the dropdown above to auto-tag this record"}
            </DialogDescription>
          </DialogHeader>
          {activeTab === "lookup"
            ? renderTransportForm(transportForm, setTransportForm)
            : renderBundleForm(bundleForm, setBundleForm)}
          <div className="flex gap-2 pt-3">
            {activeTab === "lookup" ? (
              editingId ? (
                <Button
                  disabled={updateTransportMut.isPending || !transportForm.state || !transportForm.city || (!transportForm.tciBora && !transportForm.normalBora)}
                  onClick={() => updateTransportMut.mutate({ id: editingId, form: transportForm })}
                >
                  {updateTransportMut.isPending ? "Saving..." : "Save Changes"}
                </Button>
              ) : (
                <Button
                  disabled={createTransportMut.isPending || !transportForm.state || !transportForm.city || (!transportForm.tciBora && !transportForm.normalBora)}
                  onClick={() => createTransportMut.mutate(transportForm)}
                >
                  {createTransportMut.isPending ? "Saving..." : "Save"}
                </Button>
              )
            ) : (
              editingId ? (
                <Button
                  disabled={updateBundleMut.isPending || !bundleForm.productName}
                  onClick={() => updateBundleMut.mutate({ id: editingId, form: bundleForm })}
                >
                  {updateBundleMut.isPending ? "Saving..." : "Save Changes"}
                </Button>
              ) : (
                <Button
                  disabled={createBundleMut.isPending || !bundleForm.productName}
                  onClick={() => createBundleMut.mutate(bundleForm)}
                >
                  {createBundleMut.isPending ? "Saving..." : "Save"}
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditingId(null); }}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Sheet Dialog — unit selection is mandatory */}
      <Dialog open={uploadOpen} onOpenChange={o => {
        if (!o) { setUploadOpen(false); setUploadUnit(""); setSelectedFile(""); if (fileRef.current) fileRef.current.value = ""; }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload Sheet
            </DialogTitle>
            <DialogDescription>
              Select the unit this sheet belongs to — every imported row will be tagged with this unit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Select Unit *</Label>
              <Select value={uploadUnit} onValueChange={setUploadUnit}>
                <SelectTrigger><SelectValue placeholder="Choose a unit" /></SelectTrigger>
                <SelectContent>
                  {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Excel / CSV File *</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={() => setSelectedFile(fileRef.current?.files?.[0]?.name || "")}
              />
              {selectedFile && <p className="text-xs text-muted-foreground mt-1">{selectedFile}</p>}
            </div>
          </div>
          <div className="flex gap-2 pt-3">
            <Button size="sm" disabled={!uploadUnit || !selectedFile} onClick={handleUploadContinue}>
              Continue to Preview
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setUploadOpen(false); setUploadUnit(""); setSelectedFile(""); if (fileRef.current) fileRef.current.value = ""; }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Import Preview — {preview?.fileName}
            </DialogTitle>
            <DialogDescription>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge variant="outline" className="bg-blue-50 text-blue-700">{preview ? PARSER_LABELS[preview.parser] : ""}</Badge>
                <Badge variant="outline" className="bg-green-50">{preview?.summary.valid} valid</Badge>
                {preview && preview.summary.invalid > 0 && <Badge variant="destructive">{preview.summary.invalid} skipped</Badge>}
                {preview && preview.warnings.length > 0 && <Badge variant="outline" className="bg-yellow-50 text-yellow-700">{preview.warnings.length} warnings</Badge>}
                {importUnit && <Badge variant="outline" className="bg-teal-50 text-teal-700">Tagging unit: {importUnit}</Badge>}
              </div>
            </DialogDescription>
          </DialogHeader>

          {preview && preview.warnings.length > 0 && (
            <div className="p-3 bg-yellow-50 rounded-md border border-yellow-200 max-h-24 overflow-y-auto">
              <p className="text-xs font-medium text-yellow-800 mb-1">Warnings:</p>
              {preview.warnings.slice(0, 5).map((w: any, i: number) => (
                <p key={i} className="text-xs text-yellow-700">{w.row ? `Row ${w.row}: ` : ""}{w.message}</p>
              ))}
              {preview.warnings.length > 5 && <p className="text-xs text-yellow-600">...and {preview.warnings.length - 5} more</p>}
            </div>
          )}

          {preview && preview.validRows.length > 0 && (
            <div className="max-h-80 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    {preview.parser === "transport" && (
                      <>
                        <TableHead>State</TableHead><TableHead>City</TableHead><TableHead>PIN</TableHead>
                        <TableHead>Transport Co.</TableHead><TableHead className="text-right">TCI Bora</TableHead><TableHead className="text-right">Normal Bora</TableHead>
                      </>
                    )}
                    {preview.parser === "liner" && (
                      <>
                        <TableHead>Product</TableHead><TableHead className="text-right">Liner Qty</TableHead>
                      </>
                    )}
                    {preview.parser === "bora" && (
                      <>
                        <TableHead>Product</TableHead><TableHead className="text-right">Bora</TableHead><TableHead className="text-right">Liner Packing</TableHead>
                      </>
                    )}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.validRows.slice(0, 30).map((row: any, i: number) => {
                    const rowNum = row._rowNum || i + 1;
                    const error = preview.errors.find(e => e.row === rowNum);
                    const warning = preview.warnings?.find((w: any) => w.row === rowNum);
                    return (
                      <TableRow key={i} className={error ? "bg-red-50" : warning ? "bg-yellow-50/50" : ""}>
                        <TableCell className="text-xs">{rowNum}</TableCell>
                        {preview.parser === "transport" && (
                          <>
                            <TableCell className="text-xs">{row.state}</TableCell>
                            <TableCell className="text-xs">{row.city}</TableCell>
                            <TableCell className="text-xs font-mono">{row.pinCode || "—"}</TableCell>
                            <TableCell className="text-xs">{row.transportCompany || "—"}</TableCell>
                            <TableCell className="text-xs text-right">{row.tciBora || 0}</TableCell>
                            <TableCell className="text-xs text-right">{row.normalBora || 0}</TableCell>
                          </>
                        )}
                        {preview.parser === "liner" && (
                          <>
                            <TableCell className="text-xs">{row.productName}</TableCell>
                            <TableCell className="text-xs text-right">{row.linerPackingQty || 0}</TableCell>
                          </>
                        )}
                        {preview.parser === "bora" && (
                          <>
                            <TableCell className="text-xs">{row.productName}</TableCell>
                            <TableCell className="text-xs text-right">{row.bora || 0}</TableCell>
                            <TableCell className="text-xs text-right">{row.linerPackingQty || 0}</TableCell>
                          </>
                        )}
                        <TableCell>
                          {error ? (
                            <Badge variant="destructive" className="text-xs">{error.message}</Badge>
                          ) : warning ? (
                            <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700">{warning.message}</Badge>
                          ) : (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {preview && preview.summary.valid === 0 && (
            <div className="p-4 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> No valid rows to import.
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" disabled={importing || !preview || preview.summary.valid === 0} onClick={handleImport}>
              {importing ? "Importing..." : `Import ${preview?.summary.valid || 0} Records`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
