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
import { Package, Plus, Check, Trash2, Save, RotateCcw, History } from "lucide-react";

type ServerRow = {
  id: number;
  productId: number | null;
  productName: string;
  unitName: string;
  currentStock: number;
  createdAt: string;
  updatedAt: string;
};

type LedgerRow = {
  _key: string;
  id: number | null;
  productName: string;
  oldQty: number;
  newQty: string;
  dirty: boolean;
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

let rowCounter = 0;
function newKey(): string {
  return `new-${++rowCounter}-${Date.now()}`;
}

function buildLedgerRows(server: ServerRow[]): LedgerRow[] {
  return server.map((r) => ({
    _key: `server-${r.id}`,
    id: r.id,
    productName: r.productName,
    oldQty: r.currentStock,
    newQty: "",
    dirty: false,
  }));
}

function calcFinalQty(row: LedgerRow): number {
  const adj = row.newQty === "" ? 0 : Number(row.newQty);
  return row.oldQty + (isNaN(adj) ? 0 : adj);
}

export default function Inventory() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { units: activeUnits } = useActiveUnits();

  const canEdit = (user as any)?.role === "admin" || (user as any)?.role === "inventory";

  // Unit filter
  const [unitFilter, setUnitFilter] = useState<string>("all");

  // Resolve which unit to actually use for queries
  const effectiveUnit = useMemo(() => {
    if (!canEdit) return undefined;
    if ((user as any)?.unit !== "All" && unitFilter === "all") return (user as any)?.unit;
    if (unitFilter !== "all") return unitFilter;
    return undefined;
  }, [user, unitFilter, canEdit]);

  // Ledger rows (local editable state)
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Fetch server data
  const { data: serverData, isLoading } = useQuery<ServerRow[]>({
    queryKey: ["inventory", effectiveUnit],
    queryFn: () => customFetch<any>(`/inventory${effectiveUnit ? `?unit=${encodeURIComponent(effectiveUnit)}` : ""}`),
    enabled: !!user,
  });

  // Sync server data into local ledger rows (once per fetch)
  const lastServerKey = useRef("");
  const serverKey = useMemo(() => {
    return JSON.stringify(serverData?.map((r: ServerRow) => r.id).sort());
  }, [serverData]);

  if (serverData && serverKey !== lastServerKey.current) {
    lastServerKey.current = serverKey;
    const fresh = buildLedgerRows(serverData);
    setRows(fresh);
    setInitialized(true);
  }

  // Save mutation
  const saveRow = useMutation({
    mutationFn: (data: { id?: number | null; productName: string; unitName: string; quantity: number }) =>
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

  // Add new blank row
  const addRow = useCallback(() => {
    if (!effectiveUnit && (user as any)?.unit === "All" && unitFilter === "all") {
      toast({ title: "Please select a unit first", variant: "destructive" });
      return;
    }
    const newRow: LedgerRow = {
      _key: newKey(),
      id: null,
      productName: "",
      oldQty: 0,
      newQty: "",
      dirty: true,
    };
    setRows((prev) => [newRow, ...prev]);
  }, [effectiveUnit, unitFilter, user, toast, canEdit]);

  // Update a cell in a row
  const updateCell = useCallback((key: string, field: "productName" | "newQty", value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r._key !== key) return r;
        const updated = { ...r, [field]: value, dirty: true };
        return updated;
      })
    );
  }, []);

  // Save a single row
  const handleSaveRow = useCallback(
    (row: LedgerRow) => {
      const unitName = effectiveUnit || (user as any)?.unit || unitFilter;
      if (!unitName || unitName === "all") {
        toast({ title: "Please select a unit first", variant: "destructive" });
        return;
      }
      if (!row.productName.trim()) {
        toast({ title: "Product name is required", variant: "destructive" });
        return;
      }
      const finalQty = calcFinalQty(row);
      if (finalQty < 0) {
        toast({ title: "Final quantity cannot be negative", variant: "destructive" });
        return;
      }
      saveRow.mutate({
        id: row.id,
        productName: row.productName.trim(),
        unitName,
        quantity: finalQty,
      });
    },
    [effectiveUnit, unitFilter, user, saveRow, toast]
  );

  // Delete a row
  const handleDeleteRow = useCallback(
    (row: LedgerRow) => {
      if (!row.id) {
        // New unsaved row — just remove from local state
        setRows((prev) => prev.filter((r) => r._key !== row._key));
        return;
      }
      deleteRow.mutate(row.id);
    },
    [deleteRow]
  );

  // Discard local changes (revert to server state)
  const handleDiscard = useCallback(() => {
    if (serverData) {
      setRows(buildLedgerRows(serverData));
    }
  }, [serverData]);

  // Logs dialog
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsProductName, setLogsProductName] = useState<string | null>(null);

  const { data: logs, isLoading: logsLoading } = useQuery<InventoryLog[]>({
    queryKey: ["inventory-logs", logsProductName],
    queryFn: () =>
      customFetch<any>(`/inventory/logs?productName=${encodeURIComponent(logsProductName || "")}&unit=${effectiveUnit || ""}`),
    enabled: logsOpen && !!logsProductName,
  });

  const openLogs = (productName: string) => {
    setLogsProductName(productName);
    setLogsOpen(true);
  };

  const dirtyCount = rows.filter((r) => r.dirty).length;

  // ─── Loading skeleton ───
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
            <Package className="h-6 w-6" /> Inventory Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canEdit ? "Type product name, enter NEW QTY, then save each row" : "Read-only view of inventory"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Unit filter */}
          {canEdit && (
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-[160px]">
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
          {canEdit && (
            <>
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

      {/* Ledger Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="w-14 text-center py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">NO</th>
                <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">PRODUCT NAME</th>
                <th className="w-28 text-right py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">OLD QTY</th>
                <th className="w-28 text-right py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">NEW QTY</th>
                <th className="w-28 text-right py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">FINAL QTY</th>
                {canEdit && <th className="w-24 text-center py-2.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">ACTIONS</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-16 text-center text-muted-foreground">
                    {canEdit ? (
                      <div className="space-y-2">
                        <p className="text-sm">No inventory entries yet.</p>
                        <p className="text-xs">Click <strong>"Add Row"</strong> to start entering stock data.</p>
                      </div>
                    ) : (
                      "No inventory data available."
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const finalQty = calcFinalQty(row);
                  const isNegative = finalQty < 0;
                  return (
                    <tr
                      key={row._key}
                      className={`border-b last:border-0 transition-colors ${
                        row.dirty ? "bg-amber-50/50" : "hover:bg-muted/10"
                      }`}
                    >
                      {/* NO */}
                      <td className="py-1.5 px-3 text-center text-muted-foreground text-xs font-mono">
                        {idx + 1}
                      </td>

                      {/* PRODUCT NAME */}
                      <td className="py-1.5 px-3">
                        {canEdit ? (
                          <Input
                            value={row.productName}
                            onChange={(e) => updateCell(row._key, "productName", e.target.value)}
                            placeholder="Type product name..."
                            className="h-8 text-sm border-dashed focus:border-solid bg-transparent"
                            tabIndex={0}
                          />
                        ) : (
                          <span className="font-medium">{row.productName}</span>
                        )}
                      </td>

                      {/* OLD QTY (read-only) */}
                      <td className="py-1.5 px-3 text-right">
                        <span className={`font-mono text-sm font-semibold ${
                          row.oldQty > 0 ? "text-green-700" : "text-muted-foreground"
                        }`}>
                          {row.oldQty.toLocaleString()}
                        </span>
                      </td>

                      {/* NEW QTY (input) */}
                      <td className="py-1.5 px-3">
                        {canEdit ? (
                          <Input
                            type="number"
                            value={row.newQty}
                            onChange={(e) => updateCell(row._key, "newQty", e.target.value)}
                            placeholder="0"
                            className="h-8 text-sm text-right font-mono border-dashed focus:border-solid bg-transparent"
                            tabIndex={0}
                          />
                        ) : (
                          <span className="font-mono text-sm text-muted-foreground">
                            {row.newQty || "-"}
                          </span>
                        )}
                      </td>

                      {/* FINAL QTY (auto-calculated, read-only) */}
                      <td className="py-1.5 px-3 text-right">
                        <span className={`font-mono text-sm font-bold ${
                          isNegative ? "text-red-600" : finalQty > 0 ? "text-green-700" : "text-muted-foreground"
                        }`}>
                          {finalQty.toLocaleString()}
                        </span>
                      </td>

                      {/* ACTIONS */}
                      {canEdit && (
                        <td className="py-1.5 px-3">
                          <div className="flex items-center justify-center gap-1">
                            {/* Save button */}
                            <Button
                              size="sm"
                              variant={row.dirty ? "default" : "ghost"}
                              className={`h-7 w-7 p-0 ${row.dirty ? "bg-green-600 hover:bg-green-700 text-white" : "text-green-600"}`}
                              onClick={() => handleSaveRow(row)}
                              disabled={!row.dirty || saveRow.isPending}
                              title="Save row"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>

                            {/* History button (only for existing rows) */}
                            {row.id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground"
                                onClick={() => openLogs(row.productName)}
                                title="View history"
                              >
                                <History className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            {/* Delete button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteRow(row)}
                              title={row.id ? "Delete from database" : "Remove row"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

      {/* Footer info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} product{rows.length !== 1 ? "s" : ""}
          {dirtyCount > 0 && <span className="ml-2 text-amber-600 font-medium">({dirtyCount} unsaved)</span>}
        </span>
        <span>Enter NEW QTY: positive = add, negative = subtract</span>
      </div>

      {/* Stock History Dialog */}
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
