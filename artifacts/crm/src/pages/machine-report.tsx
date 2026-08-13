import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { BarChart3, Package, Clock, Settings2, Factory } from "lucide-react";
import { useUserUnits } from "@/lib/use-user-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useStatusFilter } from "@/lib/global-filters";
import { ClearFiltersButton } from "@/components/clear-filters-button";

const MACHINE_TYPES = ["All", "250ml Machine", "1L Machine", "5L Machine"];
const STATUS_OPTIONS = ["All", "Pending", "Production On Going"];
const MATERIAL_OPTIONS = ["All", "HDPE", "PET", "PP"];

interface ReportData {
  summary: { totalProducts: number; totalBottles: number; pending: number; inProduction: number; completed: number };
  materialBreakdown: {
    materialType: string;
    machines: { machineType: string; productCount: number; orderCount: number; totalBottles: number; pendingQty: number; inProductionQty: number; completedQty: number }[];
  }[];
  orders: { orderId: number; orderNumber: string | null; status: string; productionUnit: string; createdAt: string; productName: string; machineType: string | null; materialType: string | null; quantity: number; readyQuantity: number; bottleColour: string | null; bottleWeight: string | null; productCode: string | null }[];
}

export default function MachineReport() {
  const { data: user } = useGetMe();
  const { units: accessibleUnits, locked: unitLocked } = useUserUnits();
  const [unitFilter, setUnitFilter] = useUnitFilter();
  const [machineFilter, setMachineFilter] = useState("All");
  const [globalStatus, setGlobalStatus] = useStatusFilter();
  const statusFilter = STATUS_OPTIONS.includes(globalStatus) ? globalStatus : "All";
  const setStatusFilter = (v: string) => setGlobalStatus(v);
  const [materialFilter, setMaterialFilter] = useState("All");

  const showUnitFilter = user?.role === "admin" || user?.role === "production_and_support" || user?.unit === "All";

  const params = new URLSearchParams();
  if (unitFilter !== "All") params.set("unit", unitFilter);
  if (machineFilter !== "All") params.set("machineType", machineFilter);
  if (statusFilter !== "All") params.set("status", statusFilter);
  const qs = params.toString();

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["machine-report", unitFilter, machineFilter, statusFilter],
    queryFn: () => customFetch<ReportData>(`/production/machine-report${qs ? `?${qs}` : ""}`),
    enabled: !!user,
  });

  const materialBreakdown = data?.materialBreakdown || [];
  const orders = data?.orders || [];

  // Material filter is applied client-side so the KPI cards, the Material-wise
  // Breakdown and the Product Lines table all narrow to the selected material
  // (HDPE / PET / PP) without an extra backend round-trip.
  const filteredOrders = materialFilter === "All"
    ? orders
    : orders.filter(o => o.materialType === materialFilter);
  const filteredBreakdown = materialFilter === "All"
    ? materialBreakdown
    : materialBreakdown.filter(g => g.materialType === materialFilter);

  const totalProducts = filteredOrders.length;
  const totalBottles = filteredOrders.reduce((s, o) => s + (o.quantity - (o.readyQuantity || 0)), 0);

  // Sum of pieces (remaining quantities) per status bucket for the current
  // filters — derived from the backend's materialBreakdown so the same
  // status-bucket logic as the dashboard drives the totals.
  const pendingPcs = filteredBreakdown.reduce(
    (s, g) => s + g.machines.reduce((m, x) => m + (Number(x.pendingQty) || 0), 0),
    0
  );
  const inProductionPcs = filteredBreakdown.reduce(
    (s, g) => s + g.machines.reduce((m, x) => m + (Number(x.inProductionQty) || 0), 0),
    0
  );

  const SUMMARY_CARDS = [
    { label: "Total Products", value: totalProducts, icon: Package, color: "text-blue-600" },
    { label: "Total Bottles", value: totalBottles.toLocaleString(), icon: BarChart3, color: "text-purple-600" },
    { label: "Pending PCS", value: pendingPcs.toLocaleString(), icon: Clock, color: "text-gray-600" },
    { label: "In Production PCS", value: inProductionPcs.toLocaleString(), icon: Settings2, color: "text-orange-600" },
  ];

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      "Pending": "bg-gray-100 text-gray-700 border-gray-300",
      "Accepted": "bg-indigo-100 text-indigo-700 border-indigo-300",
      "Planning": "bg-cyan-100 text-cyan-700 border-cyan-300",
      "In Production": "bg-orange-100 text-orange-700 border-orange-300",
      "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
      "Packing": "bg-yellow-100 text-yellow-700 border-yellow-300",
    };
    return map[s] || "bg-gray-100 text-gray-700 border-gray-300";
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Machine-wise Production Report</h1>
        <p className="text-muted-foreground mt-1">Production analytics by machine type</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {showUnitFilter && (
          <div className="flex items-center gap-2">
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={unitLocked}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Units" /></SelectTrigger>
              <SelectContent>
                {accessibleUnits.map(u => <SelectItem key={u} value={u}>{u === "All" ? "All Units" : u}</SelectItem>)}
              </SelectContent>
            </Select>
            {unitLocked && <span className="text-xs text-muted-foreground">Locked</span>}
          </div>
        )}
        <Select value={machineFilter} onValueChange={setMachineFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Machines" /></SelectTrigger>
          <SelectContent>
            {MACHINE_TYPES.map(m => <SelectItem key={m} value={m}>{m === "All" ? "All Machines" : m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Order Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s === "All" ? "All Order Status" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={materialFilter} onValueChange={setMaterialFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Products" /></SelectTrigger>
          <SelectContent>
            {MATERIAL_OPTIONS.map(m => <SelectItem key={m} value={m}>{m === "All" ? "All Products" : m}</SelectItem>)}
          </SelectContent>
        </Select>
        <ClearFiltersButton onClear={() => { setMachineFilter("All"); setMaterialFilter("All"); }} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {SUMMARY_CARDS.map(card => (
            <Card key={card.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${card.color}`}><card.icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold">{card.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Factory className="h-5 w-5" /> Material-wise Breakdown</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32" /> : filteredBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No data available for selected filters.</p>
          ) : (
            <div className="space-y-6">
              {filteredBreakdown.map(group => (
                <div key={group.materialType}>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-base font-bold text-foreground">{group.materialType}</h3>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 ml-2">
                    {group.machines.map(m => (
                      <div key={m.machineType} className="border rounded-lg p-4">
                        <h4 className="font-semibold text-sm">{m.machineType}</h4>
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-muted-foreground">Products: <span className="font-medium text-foreground">{m.productCount}</span></p>
                          <p className="text-xs text-muted-foreground">Orders: <span className="font-medium text-foreground">{m.orderCount}</span></p>
                          <p className="text-xs text-muted-foreground">Total Qty: <span className="font-medium text-foreground">{m.totalBottles.toLocaleString()} PCS</span></p>
                          <p className="text-xs text-muted-foreground">Pending: <span className="font-medium text-gray-700">{m.pendingQty.toLocaleString()} PCS</span></p>
                          <p className="text-xs text-muted-foreground">Production On Going: <span className="font-medium text-orange-700">{m.inProductionQty.toLocaleString()} PCS</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Product Lines ({filteredOrders.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Ready</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={13}><Skeleton className="h-20" /></TableCell></TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No product lines found.</TableCell></TableRow>
                ) : (
                  filteredOrders.map((o, idx) => (
                    <TableRow key={`${o.orderId}-${idx}`}>
                      <TableCell className="font-mono text-sm">{o.orderNumber || `#${o.orderId}`}</TableCell>
                      <TableCell className="font-medium">{o.productName}</TableCell>
                      <TableCell>{o.materialType || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell>{o.machineType || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.productCode || "-"}</TableCell>
                      <TableCell>{o.bottleColour || "-"}</TableCell>
                      <TableCell>{o.bottleWeight || "-"}</TableCell>
                      <TableCell>{o.productionUnit || "-"}</TableCell>
                      <TableCell>{o.quantity.toLocaleString()}</TableCell>
                      <TableCell className="text-green-700">{o.readyQuantity?.toLocaleString() || "0"}</TableCell>
                      <TableCell className="text-orange-700">{(o.quantity - (o.readyQuantity || 0)).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-xs ${statusColor(o.status)}`}>{o.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN") : "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
