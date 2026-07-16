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
import { useToast } from "@/hooks/use-toast";
import { useActiveUnits } from "@/lib/use-active-units";
import { Package, Plus, Check, Trash2, RotateCcw, History, Upload, Bold, Highlighter } from "lucide-react";
import * as XLSX from "xlsx";

type ServerRow = {
  id: number;
  productName: string;
  unitName: string;
  size: string | null;
  bottleColor: string | null;
  weight: string | null;
  stock: number;
  orderQty: number;
  formatting: { isBold?: boolean; highlightColor?: string } | null;
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
  stock: number;
  order: string;
  dirty: boolean;
  formatting: { isBold?: boolean; highlightColor?: string } | null;
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
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Red", value: "#fecaca" },
  { label: "Orange", value: "#fed7aa" },
  { label: "Purple", value: "#e9d5ff" },
  { label: "Pink", value: "#fbcfe8" },
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
    stock: r.stock,
    order: "",
    dirty: false,
    formatting: r.formatting || null,
  }));
}

function calcFinal(row: GridRow): number {
  const adj = row.order === "" ? 0 : Number(row.order);
  return row.stock + (isNaN(adj) ? 0 : adj);
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
    mutationFn: (data: { id?: number | null; productName: string; unitName: string; size?: string; bottleColor?: string; weight?: string; adjustment: number }) =>
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
    mutationFn: (data: { unitName: string; items: { productName: string; size?: string; bottleColor?: string; weight?: string; stock: number }[] }) =>
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

  // Format mutation
  const formatMutation = useMutation({
    mutationFn: ({ id, formatting }: { id: number; formatting: { isBold?: boolean; highlightColor?: string } | null }) =>
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

  // ─── Row operations ───
  const addRow = useCallback(() => {
    if (!effectiveUnit && (user as any)?.unit === "All" && unitFilter === "all") {
      toast({ title: "Please select a unit first", variant: "destructive" });
      return;
    }
    const unitForRow = effectiveUnit || (user as any)?.unit || unitFilter;
    const newRow: GridRow = {
      _key: newKey(),
      id: null,
      productName: "",
      unitName: unitForRow,
      size: "",
      bottleColor: "",
      weight: "",
      stock: 0,
      order: "",
      dirty: true,
      formatting: null,
    };
    setRows((prev) => [newRow, ...prev]);
  }, [effectiveUnit, unitFilter, user, toast]);

  const updateCell = useCallback((key: string, field: "productName" | "size" | "bottleColor" | "weight" | "stock" | "order", value: string) => {
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
      if (!row.productName.trim()) {
        toast({ title: "Product name is required", variant: "destructive" });
        return;
      }
      const finalVal = calcFinal(row);
      if (finalVal < 0) {
        toast({ title: "Final stock cannot be negative", variant: "destructive" });
        return;
      }
      saveRow.mutate({
        id: row.id,
        productName: row.productName.trim(),
        unitName,
        size: row.size || undefined,
        bottleColor: row.bottleColor || undefined,
        weight: row.weight || undefined,
        adjustment: row.order === "" ? 0 : Number(row.order) || 0,
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
            bottleColor: find("bottlecolor", "bottle", "color", "colour"),
            weight: find("weight", "wt"),
            stock: Number(find("stock", "qty", "quantity", "currentstock")) || 0,
            order: "",
            dirty: false,
            formatting: null,
          };
        }).filter((r) => r.productName.trim());

        if (mapped.length === 0) {
          toast({ title: "No valid product names found in Excel", variant: "destructive" });
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
    const items = importData
      .filter((r) => r.productName.trim())
      .map((r) => ({
        productName: r.productName.trim(),
        size: r.size || undefined,
        bottleColor: r.bottleColor || undefined,
        weight: r.weight || undefined,
        stock: r.stock,
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

      {/* Formatting Toolbar */}
      {canEdit && selectedRows.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-muted/30 border rounded-lg">
          <span className="text-xs text-muted-foreground mr-1">{selectedRows.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={applyBold}
            title="Toggle Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                className="w-5 h-5 rounded border border-gray-300 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: c.value || "#fff" }}
                title={c.label}
                onClick={() => applyHighlight(c.value)}
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 ml-2 text-muted-foreground"
            onClick={() => setSelectedRows(new Set())}
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
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[180px]">PRODUCT NAME</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">SIZE</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[120px]">BOTTLE COLOR</th>
                <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[100px]">WEIGHT</th>
                <th className="w-24 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">STOCK</th>
                <th className="w-24 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">ORDER</th>
                <th className="w-24 text-right py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">FINAL</th>
                {canEdit && <th className="w-20 text-center py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">ACTIONS</th>}
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
                  const finalVal = calcFinal(row);
                  const isNegative = finalVal < 0;
                  const isSelected = selectedRows.has(row._key);
                  const bgColor = row.formatting?.highlightColor || (isSelected ? "#f0f9ff" : undefined);
                  const isBold = row.formatting?.isBold;

                  return (
                    <tr
                      key={row._key}
                      className={`border-b last:border-0 transition-colors ${
                        row.dirty ? "bg-amber-50/50" : "hover:bg-muted/10"
                      }`}
                      style={bgColor ? { backgroundColor: bgColor } : undefined}
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
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.productName}
                            onChange={(e) => updateCell(row._key, "productName", e.target.value)}
                            placeholder="Product name..."
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span className="font-medium">{row.productName}</span>
                        )}
                      </td>

                      {/* SIZE */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.size}
                            onChange={(e) => updateCell(row._key, "size", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span>{row.size || "-"}</span>
                        )}
                      </td>

                      {/* BOTTLE COLOR */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.bottleColor}
                            onChange={(e) => updateCell(row._key, "bottleColor", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span>{row.bottleColor || "-"}</span>
                        )}
                      </td>

                      {/* WEIGHT */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            value={row.weight}
                            onChange={(e) => updateCell(row._key, "weight", e.target.value)}
                            placeholder="-"
                            className="h-7 text-sm border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span>{row.weight || "-"}</span>
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
                          <span className={`font-mono text-sm font-semibold ${row.stock > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                            {row.stock.toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* ORDER (adjustment) */}
                      <td className={`py-1 px-2 ${isBold ? "font-bold" : ""}`}>
                        {canEdit ? (
                          <Input
                            type="number"
                            value={row.order}
                            onChange={(e) => updateCell(row._key, "order", e.target.value)}
                            placeholder="0"
                            className="h-7 text-sm text-right font-mono border-dashed focus:border-solid bg-transparent"
                          />
                        ) : (
                          <span className="font-mono text-sm text-muted-foreground">
                            {row.order || "-"}
                          </span>
                        )}
                      </td>

                      {/* FINAL (auto-calculated) */}
                      <td className={`py-1 px-2 text-right ${isBold ? "font-bold" : ""}`}>
                        <span className={`font-mono text-sm font-bold ${
                          isNegative ? "text-red-600" : finalVal > 0 ? "text-green-700" : "text-muted-foreground"
                        }`}>
                          {finalVal.toLocaleString()}
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
          {rows.length} product{rows.length !== 1 ? "s" : ""}
          {dirtyCount > 0 && <span className="ml-2 text-amber-600 font-medium">({dirtyCount} unsaved)</span>}
        </span>
        <span>ORDER: enter positive to add, negative to subtract — FINAL = STOCK + ORDER</span>
      </div>

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
                Expected columns: <strong>PRODUCT NAME</strong>, SIZE, BOTTLE COLOR, WEIGHT, STOCK
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
                File: <strong>{importFileName}</strong> — {importData.length} products found
              </div>
              <div className="max-h-[300px] overflow-auto border rounded">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="py-1.5 px-2 text-left">PRODUCT NAME</th>
                      <th className="py-1.5 px-2 text-left">SIZE</th>
                      <th className="py-1.5 px-2 text-left">BOTTLE COLOR</th>
                      <th className="py-1.5 px-2 text-left">WEIGHT</th>
                      <th className="py-1.5 px-2 text-right">STOCK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.map((row, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-muted/10">
                        <td className="py-1 px-2 font-medium">{row.productName}</td>
                        <td className="py-1 px-2">{row.size || "-"}</td>
                        <td className="py-1 px-2">{row.bottleColor || "-"}</td>
                        <td className="py-1 px-2">{row.weight || "-"}</td>
                        <td className="py-1 px-2 text-right font-mono">{row.stock.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setImportData([]); setImportFileName(""); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmImport} disabled={bulkSave.isPending}>
                  {bulkSave.isPending ? "Importing..." : `Import ${importData.length} Products`}
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
