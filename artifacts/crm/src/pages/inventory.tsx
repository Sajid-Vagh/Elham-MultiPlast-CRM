import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useActiveUnits } from "@/lib/use-active-units";
import { Package, Plus, Minus, Search, History, ArrowUpDown } from "lucide-react";

type InventoryRow = {
  id: number;
  productId: number;
  unitName: string;
  currentStock: number;
  updatedAt: string;
  productName: string;
  category: string | null;
  productCode: string | null;
  bottleWeight: string | null;
  bottleColour: string | null;
  capColour: string | null;
  hsnCode: string | null;
  pricePerUnit: string | null;
};

type InventoryLog = {
  id: number;
  productId: number;
  unitName: string;
  adjustmentType: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  productName: string;
};

export default function Inventory() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { units: activeUnits } = useActiveUnits();

  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null);
  const [adjustType, setAdjustType] = useState<"add" | "subtract">("add");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<InventoryRow | null>(null);

  const canEdit = (user as any)?.role === "admin" || (user as any)?.role === "inventory";

  const effectiveUnit = useMemo(() => {
    if ((user as any)?.role === "admin" || (user as any)?.role === "inventory") {
      if ((user as any).unit !== "All" && unitFilter === "all") return (user as any).unit;
      if (unitFilter !== "all") return unitFilter;
      return undefined;
    }
    return undefined;
  }, [user, unitFilter]);

  const { data: inventory, isLoading } = useQuery<InventoryRow[]>({
    queryKey: ["inventory", effectiveUnit],
    queryFn: () => customFetch<any>(`/inventory${effectiveUnit ? `?unit=${encodeURIComponent(effectiveUnit)}` : ""}`),
    enabled: !!user,
  });

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    let rows = inventory;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        r.productName?.toLowerCase().includes(s) ||
        r.productCode?.toLowerCase().includes(s) ||
        r.category?.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [inventory, search]);

  const adjustStock = useMutation({
    mutationFn: (data: { productId: number; unitName: string; adjustmentType: string; quantity: number; notes?: string }) =>
      customFetch<any>("/inventory/adjust", {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setAdjustDialogOpen(false);
      setAdjustTarget(null);
      setAdjustQty("");
      setAdjustNotes("");
      toast({ title: "Stock adjusted successfully" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to adjust stock", variant: "destructive" }),
  });

  const { data: logs, isLoading: logsLoading } = useQuery<InventoryLog[]>({
    queryKey: ["inventory-logs", logsTarget?.productId, logsTarget?.unitName],
    queryFn: () => customFetch<any>(`/inventory/logs?productId=${logsTarget?.productId}&unit=${logsTarget?.unitName || ""}`),
    enabled: logsDialogOpen && !!logsTarget,
  });

  const openAdjustDialog = (row: InventoryRow, type: "add" | "subtract") => {
    setAdjustTarget(row);
    setAdjustType(type);
    setAdjustQty("");
    setAdjustNotes("");
    setAdjustDialogOpen(true);
  };

  const handleAdjustSubmit = () => {
    if (!adjustTarget || !adjustQty) return;
    const qty = Number(adjustQty);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Please enter a valid positive number", variant: "destructive" });
      return;
    }
    adjustStock.mutate({
      productId: adjustTarget.productId,
      unitName: adjustTarget.unitName,
      adjustmentType: adjustType,
      quantity: qty,
      notes: adjustNotes || undefined,
    });
  };

  const openLogsDialog = (row: InventoryRow) => {
    setLogsTarget(row);
    setLogsDialogOpen(true);
  };

  const summaryStats = useMemo(() => {
    if (!filteredInventory) return { totalProducts: 0, totalStock: 0, lowStock: 0 };
    const totalProducts = filteredInventory.length;
    const totalStock = filteredInventory.reduce((sum, r) => sum + r.currentStock, 0);
    const lowStock = filteredInventory.filter(r => r.currentStock <= 10).length;
    return { totalProducts, totalStock, lowStock };
  }, [filteredInventory]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6" /> Inventory Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage stock levels across units
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Products</div>
            <div className="text-2xl font-bold mt-1">{summaryStats.totalProducts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Stock Units</div>
            <div className="text-2xl font-bold mt-1">{summaryStats.totalStock.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Low Stock Items</div>
            <div className="text-2xl font-bold mt-1 text-amber-600">{summaryStats.lowStock}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {(user as any)?.role === "admin" || (user as any)?.role === "inventory" ? (
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units</SelectItem>
              {activeUnits.filter(u => u !== "Not Sure").map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {/* Excel-like Data Grid */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">#</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Product Name</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category / Size</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Product Code</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">
                    <span className="flex items-center justify-center gap-1">
                      <ArrowUpDown className="h-3 w-3" /> Current Stock
                    </span>
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Unit</th>
                  {canEdit && (
                    <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  )}
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Log</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} className="py-12 text-center text-muted-foreground">
                      {search ? "No products match your search." : "No inventory records found. Stock entries will appear here once products are added to inventory."}
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((row, idx) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2.5 px-4 font-medium">{row.productName}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">
                        {[row.category, row.bottleWeight, row.bottleColour].filter(Boolean).join(" / ") || "-"}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">{row.productCode || "-"}</td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge
                          variant="outline"
                          className={`text-sm font-bold px-3 py-1 ${
                            row.currentStock <= 0
                              ? "bg-red-50 text-red-700 border-red-200"
                              : row.currentStock <= 10
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-green-50 text-green-700 border-green-200"
                          }`}
                        >
                          {row.currentStock.toLocaleString()}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
                          {row.unitName}
                        </Badge>
                      </td>
                      {canEdit && (
                        <td className="py-2.5 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-green-600 border-green-200 hover:bg-green-50"
                              onClick={() => openAdjustDialog(row, "add")}
                              title="Add stock"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => openAdjustDialog(row, "subtract")}
                              title="Subtract stock"
                              disabled={row.currentStock <= 0}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      )}
                      <td className="py-2.5 px-4 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-muted-foreground"
                          onClick={() => openLogsDialog(row)}
                          title="View history"
                        >
                          <History className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Adjust Stock Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {adjustType === "add" ? (
                <><Plus className="h-5 w-5 text-green-600" /> Add Stock</>
              ) : (
                <><Minus className="h-5 w-5 text-red-600" /> Subtract Stock</>
              )}
            </DialogTitle>
          </DialogHeader>
          {adjustTarget && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/30 rounded-lg text-sm">
                <div className="font-medium">{adjustTarget.productName}</div>
                <div className="text-muted-foreground mt-0.5">
                  Unit: {adjustTarget.unitName} | Current Stock: <span className="font-bold">{adjustTarget.currentStock}</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Quantity *</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Enter quantity"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  placeholder="Reason for adjustment..."
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!adjustQty || adjustStock.isPending}
              onClick={handleAdjustSubmit}
              className={adjustType === "add" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
            >
              {adjustStock.isPending ? "Processing..." : adjustType === "add" ? "Add Stock" : "Subtract Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock History Dialog */}
      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Stock History
            </DialogTitle>
            {logsTarget && (
              <p className="text-sm text-muted-foreground">
                {logsTarget.productName} — {logsTarget.unitName}
              </p>
            )}
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {logsLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !logs || logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No adjustment history yet.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg text-sm">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      log.adjustmentType === "add" ? "bg-green-100 text-green-600" :
                      log.adjustmentType === "subtract" ? "bg-red-100 text-red-600" :
                      "bg-blue-100 text-blue-600"
                    }`}>
                      {log.adjustmentType === "add" ? <Plus className="h-4 w-4" /> :
                       log.adjustmentType === "subtract" ? <Minus className="h-4 w-4" /> :
                       <ArrowUpDown className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">
                        {log.adjustmentType === "add" ? "+" : log.adjustmentType === "subtract" ? "-" : "="}
                        {" "}{log.quantity.toLocaleString()}
                        <span className="text-muted-foreground font-normal ml-2">
                          ({log.previousStock} → {log.newStock})
                        </span>
                      </div>
                      {log.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</div>}
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(log.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
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
