import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useActiveUnits } from "@/lib/use-active-units";
import { Package, Plus, Check, Trash2, RotateCcw, History, Upload, Bold, Highlighter, Eraser } from "lucide-react";
import * as XLSX from "xlsx";

type ServerRow = {
  id: number;
  productName: string;
  unitName: string;
  size: string | null;
  bottleColor: string | null;
  weight: string | null;
  stock: number;
  clientOrder: number;
  sortOrder: number | null;
  formatting: { isBold?: boolean; highlightColor?: string; textColor?: string } | null;
  createdAt: string;
  updatedAt: string;
};

type GridRow = {
  _key: string;
  id: number | null;
  productName: string;
  unitName: string;
  size: string;
  bottleColor: string;
  weight: string;
  stock: string;
  clientOrder: string;
  sortOrder: number | null;
  dirty: boolean;
  formatting: { isBold?: boolean; highlightColor?: string; textColor?: string } | null;
};

type InventoryLog = {
  id: number;
  productName: string;
  unitName: string;
  adjustmentType: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
};

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Black", value: "#000000" },
  { label: "Dark Red", value: "#991b1b" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Gold", value: "#eab308" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Lime", value: "#bef264" },
  { label: "Green", value: "#22c55e" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Cyan", value: "#67e8f9" },
  { label: "Sky", value: "#7dd3fc" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
  { label: "Rose", value: "#fda4af" },
  { label: "Lavender", value: "#e9d5ff" },
  { label: "Light Blue", value: "#bfdbfe" },
  { label: "Mint", value: "#bbf7d0" },
  { label: "Peach", value: "#fed7aa" },
  { label: "Light Gray", value: "#e5e7eb" },
  { label: "Gray", value: "#9ca3af" },
  { label: "Dark Gray", value: "#4b5563" },
  { label: "White", value: "#ffffff" },
];

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Black", value: "#000000" },
  { label: "Dark Red", value: "#991b1b" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Gold", value: "#ca8a04" },
  { label: "Green", value: "#16a34a" },
  { label: "Teal", value: "#0d9488" },
  { label: "Blue", value: "#2563eb" },
  { label: "Indigo", value: "#4f46e5" },
  { label: "Purple", value: "#9333ea" },
  { label: "Pink", value: "#db2777" },
  { label: "Brown", value: "#78350f" },
  { label: "Gray", value: "#6b7280" },
  { label: "White", value: "#ffffff" },
];

let rowCounter = 0;
function newKey(): string {
  return `new-${++rowCounter}-${Date.now()}`;
}

function buildGridRows(server: ServerRow[]): GridRow[] {
  return server.map((r) => ({
    _key: `server-${r.id}`,
    id: r.id,
    productName: r.productName,
    unitName: r.unitName,
    size: r.size || "",
    bottleColor: r.bottleColor || "",
    weight: r.weight || "",
    stock: String(r.stock),
    clientOrder: String(r.clientOrder || ""),
    sortOrder: r.sortOrder ?? null,
    dirty: false,
    formatting: r.formatting || null,
  }));
}

function isTitleRow(row: GridRow): boolean {
  return (
    !!row.productName.trim() &&
    !row.size &&
    !row.bottleColor &&
    !row.weight &&
    !(Number(row.stock)) &&
    !(Number(row.clientOrder))
  );
}

function isBlankRow(row: GridRow): boolean {
  return (
    !row.productName.trim() &&
    !row.size &&
    !row.bottleColor &&
    !row.weight &&
    !(Number(row.stock)) &&
    !(Number(row.clientOrder))
  );
}

function calcAdditionalQty(row: GridRow): number {
  const s = Number(row.stock) || 0;
  const c = Number(row.clientOrder) || 0;
  return s - c;
}

export default function Inventory() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { units: activeUnits } = useActiveUnits();

  const canEdit = (user as any)?.role === "admin" || (user as any)?.role === "inventory" || (user as any)?.role === "sales";

  // Unit filter
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const effectiveUnit = useMemo(() => {
    if (!canEdit) return undefined;
    if ((user as any)?.unit !== "All" && unitFilter === "all") return (user as any)?.unit;
    if (unitFilter !== "all") return unitFilter;
    return undefined;
  }, [user, unitFilter, canEdit]);

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<GridRow[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Selection state for formatting
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<GridRow[]>([]);
  const [importFileName, setImportFileName] = useState("");

  // Clear All dialog
  const [clearAllOpen, setClearAllOpen] = useState(false);

  // Fetch server data (filtered by unit)
  const { data: serverData, isLoading } = useQuery<ServerRow[]>({
    queryKey: ["inventory", effectiveUnit, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveUnit) params.set("unit", effectiveUnit);
      if (search) params.set("search", search);
      const qs = params.toString();
      return customFetch<any>(`/inventory${qs ? `?${qs}` : ""}`);
    },
    enabled: !!user,
  });

  // Sync server data into local grid rows
  const lastServerKey = useRef("");
  const serverKey = useMemo(() => {
    return JSON.stringify(serverData?.map((r: ServerRow) => r.id).sort());
  }, [serverData]);

  if (serverData && serverKey !== lastServerKey.current) {
    lastServerKey.current = serverKey;
    setRows(buildGridRows(serverData));
    setInitialized(true);
  }

  // Save mutation
  const saveRow = useMutation({
    mutationFn: (data: { id?: number | null; productName: string; unitName: string; size?: string; bottleColor?: string; weight?: string; stock: number; clientOrder: number; sortOrder?: number | null }) =>
      customFetch<any>("/inventory/save", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: "Row saved" });
    },
    onError: (err: any) => toast({ title: err.message || "Save failed", variant: "destructive" }),
  });

  // Bulk save mutation (for import)
  const bulkSave = useMutation({
    mutationFn: (data: { unitName: string; items: { productName: string; size?: string; bottleColor?: string; weight?: string; stock: number; clientOrder: number; sortOrder?: number | null }[] }) =>
      customFetch<any>("/inventory/save-bulk", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: `Imported ${data.saved} products` });
      setImportOpen(false);
      setImportData([]);
      setImportFileName("");
    },
    onError: (err: any) => toast({ title: err.message || "Import failed", variant: "destructive" }),
  });

  // Delete mutation
  const deleteRow = useMutation({
    mutationFn: (id: number) =>
      customFetch<any>(`/inventory/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: "Row deleted" });
    },
    onError: (err: any) => toast({ title: err.message || "Delete failed", variant: "destructive" }),
  });

  // Clear All mutation
  const clearAll = useMutation({
    mutationFn: (unitName?: string) => {
      const qs = unitName ? `?unitName=${encodeURIComponent(unitName)}` : "";
      return customFetch<any>(`/inventory/clear-all${qs}`, { method: "DELETE" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: `Deleted ${data.deleted} records` });
      setClearAllOpen(false);
    },
    onError: (err: any) => toast({ title: err.message || "Clear failed", variant: "destructive" }),
  });

  // Format mutation
  const formatMutation = useMutation({
    mutationFn: ({ id, formatting }: { id: number; formatting: { isBold?: boolean; highlightColor?: string; textColor?: string } | null }) =>
      customFetch<any>(`/inventory/${id}/formatting`, {
        method: "PATCH",
        body: JSON.stringify({ formatting }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err: any) => toast({ title: err.message || "Format save failed", variant: "destructive" }),
  });

  // Insert row below mutation
  const insertRow = useMutation({
    mutationFn: (data: { afterId?: number | null; unitName: string }) =>
      customFetch<any>("/inventory/insert-row", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err: any) => toast({ title: err.message || "Insert row failed", variant: "destructive" }),
  });

  const insertRowBelow = useCallback((row: GridRow) => {
    const unitName = effectiveUnit || (user as any)?.unit || unitFilter;
    if (!unitName || unitName === "all") {
      toast({ title: "Please select a unit first", variant: "destructive" });
      return;
    }
    insertRow.mutate({ afterId: row.id, unitName });
  }, [effectiveUnit, unitFilter, user, insertRow, toast]);

  // ─── Row operations ───
  const addRow = useCallback(() => {
    if (!effectiveUnit && (user as any)?.unit === "All" && unitFilter === "all") {
      toast({ title: "Please select a unit first", variant: "destructive" });
      return;
    }
    const unitForRow = effectiveUnit || (user as any)?.unit || unitFilter;
    const maxSort = rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder ?? 0)) : 0;
    const newRow: GridRow = {
      _key: newKey(),
      id: null,
      productName: "",
      unitName: unitForRow,
      size: "",
      bottleColor: "",
      weight: "",
      stock: "0",
      clientOrder: "",
      sortOrder: maxSort + 1,
      dirty: true,
      formatting: null,
    };
    setRows((prev) => [...prev, newRow]);
  }, [effectiveUnit, unitFilter, user, toast, rows]);

  const updateCell = useCallback((key: string, field: "productName" | "size" | "bottleColor" | "weight" | "stock" | "clientOrder", value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r._key !== key) return r;
        return { ...r, [field]: value, dirty: true };
      })
    );
  }, []);

  const handleSaveRow = useCallback(
    (row: GridRow) => {
      const unitName = effectiveUnit || (user as any)?.unit || unitFilter;
      if (!unitName || unitName === "all") {
        toast({ title: "Please select a unit first", variant: "destructive" });
        return;
      }
      saveRow.mutate({
        id: row.id,
        productName: row.productName.trim(),
        unitName,
        size: row.size || undefined,
        bottleColor: row.bottleColor || undefined,
        weight: row.weight || undefined,
        stock: Number(row.stock) || 0,
        clientOrder: Number(row.clientOrder) || 0,
        sortOrder: row.sortOrder,
      });
    },
    [effectiveUnit, unitFilter, user, saveRow, toast]
  );

  const handleDeleteRow = useCallback(
    (row: GridRow) => {
      if (!row.id) {
        setRows((prev) => prev.filter((r) => r._key !== row._key));
        return;
      }
      deleteRow.mutate(row.id);
    },
    [deleteRow]
  );

  const handleDiscard = useCallback(() => {
    if (serverData) {
      setRows(buildGridRows(serverData));
    }
  }, [serverData]);

  const handleClearAll = useCallback(() => {
    clearAll.mutate(effectiveUnit);
  }, [clearAll, effectiveUnit]);

  // ─── Selection & formatting ───
  const toggleSelectRow = useCallback((key: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((r) => r._key)));
    }
  }, [rows, selectedRows.size]);

  const applyBold = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedRows.has(r._key)) return r;
        const isBold = !r.formatting?.isBold;
        const formatting = { ...r.formatting, isBold };
        if (r.id) {
          formatMutation.mutate({ id: r.id, formatting });
        }
        return { ...r, formatting, dirty: r.id ? false : r.dirty };
      })
    );
  }, [selectedRows, formatMutation]);

  const applyHighlight = useCallback((color: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedRows.has(r._key)) return r;
        const formatting = { ...r.formatting, highlightColor: color || undefined };
        if (!color) delete formatting.highlightColor;
        if (Object.keys(formatting).length === 0) {
          if (r.id) formatMutation.mutate({ id: r.id, formatting: null });
          return { ...r, formatting: null, dirty: r.id ? false : r.dirty };
        }
        if (r.id) formatMutation.mutate({ id: r.id, formatting });
        return { ...r, formatting: Object.keys(formatting).length ? formatting : null, dirty: r.id ? false : r.dirty };
      })
    );
  }, [selectedRows, formatMutation]);

  const applyTextColor = useCallback((color: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedRows.has(r._key)) return r;
        const formatting = { ...r.formatting, textColor: color || undefined };
        if (!color) delete formatting.textColor;
        if (Object.keys(formatting).length === 0) {
          if (r.id) formatMutation.mutate({ id: r.id, formatting: null });
          return { ...r, formatting: null, dirty: r.id ? false : r.dirty };
        }
        if (r.id) formatMutation.mutate({ id: r.id, formatting });
        return { ...r, formatting: Object.keys(formatting).length ? formatting : null, dirty: r.id ? false : r.dirty };
      })
    );
  }, [selectedRows, formatMutation]);

  // ─── Excel Import ───
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

        if (json.length === 0) {
          toast({ title: "Excel file is empty", variant: "destructive" });
          return;
        }

        const unitForRow = effectiveUnit || (user as any)?.unit || "all";
        setImportFileName(file.name);

        // Map Excel columns — match exact headers from user's Excel sheet
        const mapped: GridRow[] = json.map((row, idx) => {
          const find = (...keys: string[]) => {
            for (const k of keys) {
              for (const col of Object.keys(row)) {
                if (col.toLowerCase().replace(/[\s_-]/g, "") === k.toLowerCase()) return String(row[col] ?? "");
              }
            }
            return "";
          };
          return {
            _key: `import-${idx}-${Date.now()}`,
            id: null,
            productName: find("productname", "product", "name", "item"),
            unitName: unitForRow,
            size: find("size", "sz"),
            bottleColor: find("colour", "color", "bottlecolor", "bottle"),
            weight: find("weight", "wt"),
            stock: find("stock", "qty", "quantity", "currentstock") || "0",
            clientOrder: find("clientorder", "clientorder", "order", "orderqty", "orderqty") || "",
            sortOrder: idx,
            dirty: false,
            formatting: null,
          };
        });

        if (mapped.length === 0) {
          toast({ title: "Excel file is empty", variant: "destructive" });
          return;
        }

        setImportData(mapped);
      } catch {
        toast({ title: "Failed to parse Excel file", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, [toast, effectiveUnit, user]);

  const confirmImport = useCallback(() => {
    const unitForRow = effectiveUnit || (user as any)?.unit || unitFilter;
    if (!unitForRow || unitForRow === "all") {
      toast({ title: "Please select a unit first", variant: "destructive" });
      return;
    }
    const items = importData.map((r) => ({
      productName: r.productName.trim(),
      size: r.size || undefined,
      bottleColor: r.bottleColor || undefined,
      weight: r.weight || undefined,
      stock: Number(r.stock) || 0,
      clientOrder: Number(r.clientOrder) || 0,
      sortOrder: r.sortOrder,
    }));
    bulkSave.mutate({ unitName: unitForRow, items });
  }, [importData, bulkSave, effectiveUnit, unitFilter, user, toast]);

  // ─── Logs dialog ───
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsProductName, setLogsProductName] = useState<string | null>(null);

  const { data: logs, isLoading: logsLoading } = useQuery<InventoryLog[]>({
    queryKey: ["inventory-logs", logsProductName, effectiveUnit],
    queryFn: () =>
      customFetch<any>(`/inventory/logs?productName=${encodeURIComponent(logsProductName || "")}&unit=${effectiveUnit || ""}`),
    enabled: logsOpen && !!logsProductName,
  });

  const openLogs = (productName: string) => {
    setLogsProductName(productName);
    setLogsOpen(true);
  };

  const dirtyCount = rows.filter((r) => r.dirty).length;

  // ─── Loading ───
  if (isLoading || !initialized) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canEdit ? "Excel-like inventory management — edit, format, import" : "Read-only view"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Unit filter */}
          {canEdit && (
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue placeholder="Select Unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Units</SelectItem>
                {activeUnits.filter((u) => u !== "Not Sure").map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[200px] h-8 text-sm"
          />
          {canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-1" /> Import Excel
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setClearAllOpen(true)}>
                <Eraser className="h-4 w-4 mr-1" /> Clear All Data
              </Button>
              <Button size="sm" onClick={addRow}>
                <Plus className="h-4 w-4 mr-1" /> Add Row
              </Button>
              {dirtyCount > 0 && (
                <Button size="sm" variant="outline" onClick={handleDiscard}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Discard ({dirtyCount})
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Formatting Toolbar — always visible when rows exist */}
      {canEdit && rows.length > 0 && (
        <div className={`flex items-center gap-3 p-2 border rounded-lg flex-wrap transition-opacity ${selectedRows.size === 0 ? "opacity-50 pointer-events-none" : "bg-muted/30"}`}>
          <span className="text-xs text-muted-foreground mr-1">
            {selectedRows.size > 0 ? `${selectedRows.size} selected` : "Select rows to format"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={applyBold}
            title="Toggle Bold"
            disabled={selectedRows.size === 0}
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>

          {/* Background Color Picker */}
          <div className="flex items-center gap-1 ml-1 border-l pl-3">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-muted-foreground leading-none mb-0.5">BG</span>
              <div className="relative">
                <Highlighter className="h-3.5 w-3.5 text-muted-foreground absolute top-0.5 left-0.5 pointer-events-none z-10" />
                <input
                  type="color"
                  className="w-6 h-6 rounded border border-gray-300 cursor-pointer p-0 opacity-0 absolute inset-0 disabled:cursor-not-allowed"
                  value={(() => {
                    const sel = rows.find(r => selectedRows.has(r._key));
                    return sel?.formatting?.highlightColor || "#ffffff";
                  })()}
                  onChange={(e) => applyHighlight(e.target.value)}
                  title="Custom background color"
                  disabled={selectedRows.size === 0}
                />
                <div
                  className="w-6 h-6 rounded border border-gray-300 pointer-events-none"
                  style={{ backgroundColor: (() => {
                    const sel = rows.find(r => selectedRows.has(r._key));
                    return sel?.formatting?.highlightColor || "#ffffff";
                  })() }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-0.5 max-w-[200px]">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  className="w-4 h-4 rounded-sm border border-gray-300 cursor-pointer hover:scale-125 transition-transform disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: c.value || "#fff" }}
                  title={c.label}
                  onClick={() => applyHighlight(c.value)}
                  disabled={selectedRows.size === 0}
                />
              ))}
            </div>
          </div>

          {/* Text Color Picker */}
          <div className="flex items-center gap-1 ml-1 border-l pl-3">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-muted-foreground leading-none mb-0.5">A</span>
              <div className="relative">
                <span className="text-xs font-bold absolute top-0.5 left-0.5 pointer-events-none z-10 leading-none">A</span>
                <input
                  type="color"
                  className="w-6 h-6 rounded border border-gray-300 cursor-pointer p-0 opacity-0 absolute inset-0 disabled:cursor-not-allowed"
                  value={(() => {
                    const sel = rows.find(r => selectedRows.has(r._key));
                    return sel?.formatting?.textColor || "#000000";
                  })()}
                  onChange={(e) => applyTextColor(e.target.value)}
                  title="Custom text color"
                  disabled={selectedRows.size === 0}
                />
                <div
                  className="w-6 h-6 rounded border border-gray-300 pointer-events-none"
                  style={{ backgroundColor: (() => {
                    const sel = rows.find(r => selectedRows.has(r._key));
                    return sel?.formatting?.textColor || "#ffffff";
                  })() }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-0.5 max-w-[160px]">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  className="w-4 h-4 rounded-sm border border-gray-300 cursor-pointer hover:scale-125 transition-transform flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: c.value || "#fff" }}
                  title={c.label}
                  onClick={() => applyTextColor(c.value)}
                  disabled={selectedRows.size === 0}
                >
                  {c.value && <span className="text-[6px] font-bold" style={{ color: c.value === "#ffffff" ? "#000" : c.value === "#000000" ? "#fff" : c.value }}>A</span>}
                </button>
              ))}
            </div>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 ml-2 text-muted-foreground"
            onClick={() => setSelectedRows(new Set())}
            disabled={selectedRows.size === 0}
          >
            Clear selection
          </Button>
        </div>
      )}

      {/* Spreadsheet Grid */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="w-10 text-center py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  {canEdit && rows.length > 0 && (
                    <input
                      type="checkbox"
                      checked={selectedRows.size === rows.length && rows.length > 0}
                      onChange={selectAll}
                      className="cursor-pointer"
                    />
                  )}
                </th>
                <th className="w-12 text-center py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">NO</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[300px]">PRODUCT NAME</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[140px]">SIZE</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[140px]">COLOUR</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[140px]">WEIGHT</th>
                <th className="w-24 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">STOCK</th>
                <th className="w-28 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">CLIENT ORDER</th>
                <th className="w-28 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">ADDITIONAL QTY</th>
                {canEdit && <th className="w-28 text-center py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">ACTIONS</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 10 : 9} className="py-16 text-center text-muted-foreground">
                    <div className="space-y-2">
                      <p className="text-sm">No inventory entries yet.</p>
                      <p className="text-xs">Click <strong>"Add Row"</strong> or <strong>"Import Excel"</strong> to start.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const additionalQty = calcAdditionalQty(row);
                  const isNegative = additionalQty < 0;
                  const isSelected = selectedRows.has(row._key);
                  const bgColor = row.formatting?.highlightColor || (isSelected ? "#f0f9ff" : undefined);
                  const txtColor = row.formatting?.textColor || undefined;
                  const isBold = row.formatting?.isBold;
                  const titleRow = isTitleRow(row);
                  const blank = isBlankRow(row);

                  const rowStyle: React.CSSProperties = {};
                  if (bgColor) rowStyle.backgroundColor = bgColor;
                  if (txtColor) rowStyle.color = txtColor;

                  return (
                    <tr
                      key={row._key}
                      className={`border-b last:border-0 transition-colors ${
                        titleRow ? "bg-blue-50/80 border-l-4 border-l-blue-400" : blank ? "bg-gray-50/40" : row.dirty ? "bg-amber-50/50" : "hover:bg-muted/10"
                      }`}
                      style={Object.keys(rowStyle).length ? rowStyle : undefined}
                    >
                      {/* Checkbox */}
                      {canEdit && (
                        <td className="py-1 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(row._key)}
                            className="cursor-pointer"
                          />
                        </td>
                      )}

                      {/* NO */}
                      <td className={`py-1 px-2 text-center text-muted-foreground text-xs font-mono ${isBold ? "font-bold" : ""}`}>
                        {idx + 1}
                      </td>

                      {/* PRODUCT NAME */}
                      <td className={`py-1 px-2 ${isBold || titleRow ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.productName}
                            onChange={(e) => updateCell(row._key, "productName", e.target.value)}
                            placeholder="Product name..."
                            className={`h-7 text-sm bg-transparent min-w-[280px] ${
                              titleRow
                                ? "font-bold text-blue-800 border-none bg-transparent text-base"
                                : "border-dashed focus:border-solid"
                            } ${isBold && !titleRow ? "font-bold" : ""}`}
                          />
                        ) : (
                          <span className={`font-medium whitespace-nowrap ${
                            titleRow ? "font-bold text-base text-blue-800" : ""
                          }`}>{row.productName || ""}</span>
                        )}
                      </td>

                      {/* SIZE */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.size}
                            onChange={(e) => updateCell(row._key, "size", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent min-w-[120px]"
                          />
                        ) : (
                          <span className="whitespace-nowrap">{row.size || "-"}</span>
                        )}
                      </td>

                      {/* COLOUR */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.bottleColor}
                            onChange={(e) => updateCell(row._key, "bottleColor", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent min-w-[120px]"
                          />
                        ) : (
                          <span className="whitespace-nowrap">{row.bottleColor || "-"}</span>
                        )}
                      </td>

                      {/* WEIGHT */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.weight}
                            onChange={(e) => updateCell(row._key, "weight", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent min-w-[120px]"
                          />
                        ) : (
                          <span className="whitespace-nowrap">{row.weight || "-"}</span>
                        )}
                      </td>

                      {/* STOCK */}
                      <td className={`py-1 px-2 text-right ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            type="number"
                            value={row.stock}
                            onChange={(e) => updateCell(row._key, "stock", e.target.value)}
                            className="h-7 text-sm text-right font-mono border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span className={`font-mono text-sm font-semibold ${(Number(row.stock) || 0) > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                            {(Number(row.stock) || 0).toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* CLIENT ORDER */}
                      <td className={`py-1 px-2 text-right ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            type="number"
                            value={row.clientOrder}
                            onChange={(e) => updateCell(row._key, "clientOrder", e.target.value)}
                            placeholder="0"
                            className="h-7 text-sm text-right font-mono border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span className="font-mono text-sm">
                            {row.clientOrder ? (Number(row.clientOrder) || 0).toLocaleString() : "-"}
                          </span>
                        )}
                      </td>

                      {/* ADDITIONAL QTY (auto-calculated: Stock - Client Order) */}
                      <td className={`py-1 px-2 text-right ${isBold ? "font-bold" : ""}`}>
                        <span className={`font-mono text-sm font-bold ${
                          isNegative ? "text-red-600" : additionalQty > 0 ? "text-green-700" : "text-muted-foreground"
                        }`}>
                          {additionalQty.toLocaleString()}
                        </span>
                      </td>

                      {/* ACTIONS */}
                      {canEdit && (
                        <td className="py-1 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant={row.dirty ? "default" : "ghost"}
                              className={`h-6 w-6 p-0 ${row.dirty ? "bg-green-600 hover:bg-green-700 text-white" : "text-green-600"}`}
                              onClick={() => handleSaveRow(row)}
                              disabled={!row.dirty || saveRow.isPending}
                              title="Save row"
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => insertRowBelow(row)}
                              disabled={insertRow.isPending}
                              title="Insert row below"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            {row.id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-muted-foreground"
                                onClick={() => openLogs(row.productName)}
                                title="View history"
                              >
                                <History className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteRow(row)}
                              title={row.id ? "Delete from database" : "Remove row"}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} row{rows.length !== 1 ? "s" : ""}
          {dirtyCount > 0 && <span className="ml-2 text-amber-600 font-medium">({dirtyCount} unsaved)</span>}
        </span>
        <span>ADDITIONAL QTY = STOCK − CLIENT ORDER</span>
      </div>

      {/* ─── Clear All Data AlertDialog ─── */}
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete ALL inventory records{effectiveUnit ? ` for "${effectiveUnit}"` : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {clearAll.isPending ? "Deleting..." : "Confirm Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Import Excel Dialog ─── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Import Excel
            </DialogTitle>
          </DialogHeader>
          {!importData.length ? (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload an Excel file (.xlsx, .xls, .csv). Columns will be auto-mapped by name.
              </p>
              <p className="text-xs text-muted-foreground">
                Expected columns: <strong>Product Name</strong>, Size, Colour, Weight, Stock, <strong>Client Order</strong>
              </p>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 transition">
                <Upload className="h-4 w-4" />
                Choose File
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                File: <strong>{importFileName}</strong> — {importData.length} rows found ({importData.filter(r => r.productName.trim()).length} products, {importData.filter(r => !r.productName.trim()).length} blank/title rows)
              </div>
              <div className="max-h-[300px] overflow-auto border rounded">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="py-1.5 px-2 text-left w-10">#</th>
                      <th className="py-1.5 px-2 text-left">Product Name</th>
                      <th className="py-1.5 px-2 text-left">Size</th>
                      <th className="py-1.5 px-2 text-left">Colour</th>
                      <th className="py-1.5 px-2 text-left">Weight</th>
                      <th className="py-1.5 px-2 text-right">Stock</th>
                      <th className="py-1.5 px-2 text-right">Client Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.map((row, idx) => {
                      const titleRow = isTitleRow(row);
                      const blank = isBlankRow(row);
                      return (
                        <tr key={idx} className={`border-b last:border-0 ${titleRow ? "bg-blue-50/60 font-bold" : blank ? "bg-gray-50/40" : "hover:bg-muted/10"}`}>
                          <td className="py-1 px-2 text-muted-foreground">{idx + 1}</td>
                          <td className="py-1 px-2 font-medium">{row.productName || "(blank)"}</td>
                          <td className="py-1 px-2">{row.size || "-"}</td>
                          <td className="py-1 px-2">{row.bottleColor || "-"}</td>
                          <td className="py-1 px-2">{row.weight || "-"}</td>
                          <td className="py-1 px-2 text-right font-mono">{(Number(row.stock) || 0).toLocaleString()}</td>
                          <td className="py-1 px-2 text-right font-mono">{row.clientOrder ? (Number(row.clientOrder) || 0).toLocaleString() : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setImportData([]); setImportFileName(""); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmImport} disabled={bulkSave.isPending}>
                  {bulkSave.isPending ? "Importing..." : `Import ${importData.length} Rows`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Stock History Dialog ─── */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Stock History
            </DialogTitle>
            {logsProductName && (
              <p className="text-sm text-muted-foreground">{logsProductName}</p>
            )}
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {logsLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !logs || logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No history yet.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium font-mono">
                        {log.previousStock.toLocaleString()} → {log.newStock.toLocaleString()}
                        <span className="text-muted-foreground font-normal ml-2 text-xs">
                          ({log.adjustmentType})
                        </span>
                      </div>
                      {log.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</div>}
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(log.createdAt).toLocaleDateString("en-IN", {
                        day: "2-digit", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
