import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { BarChart3, Package, Clock, Settings2, CheckCircle2, Factory } from "lucide-react";
import { useUserUnits } from "@/lib/use-user-units";

const MACHINE_TYPES = ["All", "250ml Machine", "1L Machine", "5L Machine"];
const STATUS_OPTIONS = ["All", "Pending", "Material Ready", "Production Started", "In Process", "Quality Check", "Packing", "Ready For Dispatch", "Completed", "On Hold", "Cancelled"];

interface ReportData {
  summary: { totalOrders: number; totalBottles: number; totalQuantity: number; pending: number; inProduction: number; completed: number };
  machineBreakdown: { machineType: string; orderCount: number; totalBottles: number }[];
  orders: { id: number; status: string; productionUnit: string; createdAt: string; productName: string; machineType: string | null; totalQuantity: number }[];
}

export default function MachineReport() {
  const { data: user } = useGetMe();
  const { units: accessibleUnits, locked: unitLocked } = useUserUnits();
  const [unitFilter, setUnitFilter] = useState("All");
  const [machineFilter, setMachineFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const showUnitFilter = user?.role === "admin" || user?.role === "production_and_support" || user?.unit === "All";

  useEffect(() => {
    if (unitLocked && accessibleUnits.length === 1) {
      setUnitFilter(accessibleUnits[0]);
    }
  }, [unitLocked, accessibleUnits]);

  const params = new URLSearchParams();
  if (unitFilter !== "All") params.set("unit", unitFilter);
  if (machineFilter !== "All") params.set("machineType", machineFilter);
  if (statusFilter !== "All") params.set("status", statusFilter);
  const qs = params.toString();

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["machine-report", unitFilter, machineFilter, statusFilter],
    queryFn: () => customFetch<ReportData>(`/products/machine-report${qs ? `?${qs}` : ""}`),
    enabled: !!user,
  });

  const summary = data?.summary;
  const machineBreakdown = data?.machineBreakdown || [];
  const orders = data?.orders || [];

  const SUMMARY_CARDS = [
    { label: "Total Orders", value: summary?.totalOrders ?? 0, icon: Package, color: "text-blue-600" },
    { label: "Total Bottles", value: (summary?.totalBottles ?? 0).toLocaleString(), icon: BarChart3, color: "text-purple-600" },
    { label: "Pending", value: summary?.pending ?? 0, icon: Clock, color: "text-gray-600" },
    { label: "In Production", value: summary?.inProduction ?? 0, icon: Settings2, color: "text-orange-600" },
    { label: "Completed", value: summary?.completed ?? 0, icon: CheckCircle2, color: "text-green-600" },
  ];

  const statusColor = (s: string) => {
    if (s === "Completed") return "bg-green-100 text-green-700 border-green-300";
    if (["Production Started", "In Process"].includes(s)) return "bg-orange-100 text-orange-700 border-orange-300";
    if (s === "Pending") return "bg-gray-100 text-gray-700 border-gray-300";
    if (s === "Material Ready") return "bg-blue-100 text-blue-700 border-blue-300";
    if (s === "Cancelled") return "bg-red-100 text-red-700 border-red-300";
    return "bg-yellow-100 text-yellow-700 border-yellow-300";
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Machine-wise Production Report</h1>
        <p className="text-muted-foreground mt-1">Production analytics by machine type (excludes outsourced/PET products)</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {showUnitFilter && (
          <div className="flex items-center gap-2">
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={unitLocked}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Unit" /></SelectTrigger>
              <SelectContent>
                {accessibleUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            {unitLocked && <span className="text-xs text-muted-foreground">Locked</span>}
          </div>
        )}
        <Select value={machineFilter} onValueChange={setMachineFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Machine Type" /></SelectTrigger>
          <SelectContent>
            {MACHINE_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

      {/* Machine-wise Breakdown */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Factory className="h-5 w-5" /> Machine-wise Breakdown</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32" /> : machineBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No data available for selected filters.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {machineBreakdown.map(m => (
                <div key={m.machineType} className="border rounded-lg p-4">
                  <h3 className="font-semibold text-sm">{m.machineType}</h3>
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Orders: <span className="font-medium text-foreground">{m.orderCount}</span></p>
                    <p className="text-xs text-muted-foreground">Bottles: <span className="font-medium text-foreground">{m.totalBottles.toLocaleString()}</span></p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardHeader><CardTitle>Production Orders ({orders.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Machine Type</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7}><Skeleton className="h-20" /></TableCell></TableRow>
                ) : orders.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No orders found.</TableCell></TableRow>
                ) : (
                  orders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-sm">#{o.id}</TableCell>
                      <TableCell className="font-medium">{o.productName}</TableCell>
                      <TableCell>{o.machineType || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell>{o.productionUnit || "-"}</TableCell>
                      <TableCell>{o.totalQuantity.toLocaleString()}</TableCell>
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
