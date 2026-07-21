import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserUnits } from "@/lib/use-user-units";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { ManufacturingSummary } from "@/components/manufacturing-summary";

const STATUS_COLORS: Record<string, string> = {
  "Accepted": "bg-blue-100 text-blue-700 border-blue-300",
  "Planning": "bg-purple-100 text-purple-700 border-purple-300",
  "In Production": "bg-orange-100 text-orange-700 border-orange-300",
  "Packing": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready For Dispatch": "bg-green-100 text-green-700 border-green-300",
  "In Transport": "bg-indigo-100 text-indigo-700 border-indigo-300",
};

const KPI_CONFIG = [
  { key: "pendingCount", label: "Pending", color: "bg-gray-100 text-gray-700 border-gray-300", hoverStatus: "Pending" },
  { key: "acceptedCount", label: "Accepted", color: "bg-blue-100 text-blue-700 border-blue-300", hoverStatus: "Accepted" },
  { key: "planningCount", label: "Planning", color: "bg-purple-100 text-purple-700 border-purple-300", hoverStatus: "Planning" },
  { key: "inProductionCount", label: "In Production", color: "bg-orange-100 text-orange-700 border-orange-300", hoverStatus: "In Production" },
  { key: "packingCount", label: "Packing", color: "bg-yellow-100 text-yellow-700 border-yellow-300", hoverStatus: "Packing" },
  { key: "readyForDispatchCount", label: "Ready for Dispatch", color: "bg-green-100 text-green-700 border-green-300", hoverStatus: "Ready For Dispatch" },
  { key: "inTransportCount", label: "In Transport", color: "bg-indigo-100 text-indigo-700 border-indigo-300", hoverStatus: "In Transport" },
  { key: "delayedOrders", label: "Delayed", color: "bg-red-100 text-red-700 border-red-300", hoverStatus: "delayed" },
];

const QUICK_ACTIONS = [
  { label: "Pending Orders", status: "Pending", icon: Clock, color: "gray" },
  { label: "Ready to Dispatch", status: "Ready For Dispatch", icon: Calendar, color: "green" },
  { label: "Delayed Orders", status: "delayed", icon: AlertTriangle, color: "red" },
];

export default function ProductionDashboard() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const { units: userUnits, locked, userUnit } = useUserUnits();
  const [selectedUnit, setSelectedUnit] = useState(userUnit);
  useEffect(() => { setSelectedUnit(userUnit); }, [userUnit]);
  const [originFilter, setOriginFilter] = useState("all");

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["production-dashboard", selectedUnit, originFilter],
    queryFn: () => customFetch<any>(`/production/dashboard?${selectedUnit && selectedUnit !== "All" ? `unit=${selectedUnit}&` : ""}${originFilter !== "all" ? `origin=${originFilter}&` : ""}`),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor production orders across all statuses</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="text-sm border rounded-md px-3 py-1.5 bg-background"
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
          >
            <option value="all">All Orders</option>
            <option value="sales">Sales Orders</option>
            <option value="production_and_support">Support Orders</option>
          </select>
          {userUnits.length > 1 && (
            <select
              className="text-sm border rounded-md px-3 py-1.5 bg-background"
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
            >
              <option value="All">All Units</option>
              {userUnits.filter(u => u !== "All").map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Status Count Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        {KPI_CONFIG.map((kpi) => {
          const Icon = kpi.key === "delayedOrders" ? AlertTriangle : Clock;
          return (
            <Card
              key={kpi.key}
              className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              onClick={() => setLocation(kpi.hoverStatus === "delayed" ? "/production/orders?status=delayed" : `/production/orders?status=${encodeURIComponent(kpi.hoverStatus)}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${kpi.color.split(" ")[1]}`}>{kpi.label}</span>
                  <Icon className={`h-3.5 w-3.5 ${kpi.color.split(" ")[1]}`} />
                </div>
                <p className="text-xl font-bold">{dashboard?.[kpi.key] ?? 0}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Manufacturing Summary */}
      <ManufacturingSummary unitFilter={String(selectedUnit)} originFilter={originFilter} />

      {/* Summary + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-xl font-bold">{dashboard?.totalOrders ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Orders</p>
                <p className="text-xl font-bold">{dashboard?.activeOrders ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completed Today</p>
                <p className="text-xl font-bold">{dashboard?.completedToday ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Delayed</p>
                <p className="text-xl font-bold text-red-600">{dashboard?.delayedOrders ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                onClick={() => setLocation(action.status === "delayed" ? "/production/orders?status=delayed" : `/production/orders?status=${encodeURIComponent(action.status)}`)}
                className="w-full text-left px-3 py-2 text-sm rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <action.icon className="h-3.5 w-3.5 text-muted-foreground" />
                {action.label}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
