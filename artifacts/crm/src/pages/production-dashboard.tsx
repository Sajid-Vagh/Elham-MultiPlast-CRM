import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserUnits } from "@/lib/use-user-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useDateFilter } from "@/lib/use-date-filter";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Clock, AlertTriangle, Truck, BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { ManufacturingSummary } from "@/components/manufacturing-summary";

const KPI_CONFIG = [
  { key: "totalBottles", label: "Total Bottles", color: "bg-purple-100 text-purple-700 border-purple-300", hoverStatus: null as string | null, icon: BarChart3 },
  { key: "pendingCount", label: "Pending PCS", color: "bg-gray-100 text-gray-700 border-gray-300", hoverStatus: "Pending", icon: Clock },
  { key: "productionOnGoingCount", label: "In Production PCS", color: "bg-orange-100 text-orange-700 border-orange-300", hoverStatus: "Production On Going", icon: Clock },
];

const QUICK_ACTIONS = [
  { label: "Pending Orders", status: "Pending", icon: Clock },
  { label: "Ready to Dispatch", status: "Ready To Dispatch", icon: Truck },
  { label: "Delayed Orders", status: "delayed", icon: AlertTriangle },
];

export default function ProductionDashboard() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const { units: userUnits, locked, userUnit } = useUserUnits();
  const [selectedUnit, setSelectedUnit] = useUnitFilter();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [originFilter, setOriginFilter] = useState("all");

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["production-dashboard", selectedUnit, originFilter, dateFilter.preset],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedUnit && selectedUnit !== "All") params.set("unit", selectedUnit);
      if (originFilter !== "all") params.set("origin", originFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      return customFetch<any>(`/production/dashboard?${params.toString()}`);
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor production orders — manufacturing only</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <select className="text-sm border rounded-md px-3 py-1.5 bg-background" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
            <option value="all">All Orders</option>
            <option value="sales">Sales Orders</option>
            <option value="production_and_support">Support Orders</option>
          </select>
          {userUnits.length > 1 && (
            <select className="text-sm border rounded-md px-3 py-1.5 bg-background" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}>
              <option value="All">All Units</option>
              {userUnits.filter(u => u !== "All").map(u => (<option key={u} value={u}>{u}</option>))}
            </select>
          )}
        </div>
      </div>

      {/* Status Count Cards — Total Bottles = Pending + In Production */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {KPI_CONFIG.map((kpi) => {
          const Icon = kpi.icon;
          const value = kpi.key === "totalBottles"
            ? (dashboard?.pendingCount ?? 0) + (dashboard?.productionOnGoingCount ?? 0)
            : (dashboard?.[kpi.key] ?? 0);
          const clickable = kpi.hoverStatus;
          return (
            <Card key={kpi.key} className={clickable ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200" : ""}
              onClick={clickable ? () => setLocation(`/production/orders?status=${encodeURIComponent(clickable)}`) : undefined}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${kpi.color.split(" ")[1]}`}>{kpi.label}</span>
                  <Icon className={`h-3.5 w-3.5 ${kpi.color.split(" ")[1]}`} />
                </div>
                <p className="text-xl font-bold">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">pieces</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Manufacturing Summary — excludes Ready To Dispatch, Completed, Cancelled */}
      <ManufacturingSummary unitFilter={String(selectedUnit)} originFilter={originFilter} />

      {/* Summary + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-xs text-muted-foreground">Total Orders</p><p className="text-xl font-bold">{dashboard?.totalOrders ?? 0}</p></div>
              <div><p className="text-xs text-muted-foreground">Active (Manufacturing)</p><p className="text-xl font-bold">{dashboard?.activeOrders ?? 0}</p></div>
              <div><p className="text-xs text-muted-foreground">Completed Today</p><p className="text-xl font-bold">{dashboard?.completedToday ?? 0}</p></div>
              <div><p className="text-xs text-muted-foreground">Delayed</p><p className="text-xl font-bold text-red-600">{dashboard?.delayedOrders ?? 0}</p></div>
            </div>
            {dashboard?.productLineStats && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Product Line Summary</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Pending</p><p className="font-bold text-gray-700">{dashboard.productLineStats.pendingPieces.toLocaleString()} PCS</p></div>
                  <div><p className="text-xs text-muted-foreground">In Production</p><p className="font-bold text-orange-700">{dashboard.productLineStats.inProductionPieces.toLocaleString()} PCS</p></div>
                  <div><p className="text-xs text-muted-foreground">Ready</p><p className="font-bold text-green-700">{dashboard.productLineStats.readyPieces.toLocaleString()} PCS</p></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {QUICK_ACTIONS.map(action => (
              <button key={action.label}
                onClick={() => setLocation(action.status === "delayed" ? "/production/orders?status=delayed" : `/production/orders?status=${encodeURIComponent(action.status)}`)}
                className="w-full text-left px-3 py-2 text-sm rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-2">
                <action.icon className="h-3.5 w-3.5 text-muted-foreground" />{action.label}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
