import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Factory, PackageCheck, Settings2, ShieldCheck, Package, Truck, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

const STATUS_CARDS = [
  { key: "pendingCount", label: "Pending Orders", icon: Clock, color: "bg-gray-100 text-gray-700 border-gray-300", hoverStatus: "Pending" },
  { key: "materialReadyCount", label: "Material Ready", icon: PackageCheck, color: "bg-blue-100 text-blue-700 border-blue-300", hoverStatus: "Material Ready" },
  { key: "inProductionCount", label: "In Production", icon: Settings2, color: "bg-orange-100 text-orange-700 border-orange-300", hoverStatus: "in-production" },
  { key: "qualityCheckCount", label: "Quality Check", icon: ShieldCheck, color: "bg-yellow-100 text-yellow-700 border-yellow-300", hoverStatus: "Quality Check" },
  { key: "packingCount", label: "Packing", icon: Package, color: "bg-cyan-100 text-cyan-700 border-cyan-300", hoverStatus: "Packing" },
  { key: "readyForDispatchCount", label: "Ready for Dispatch", icon: Truck, color: "bg-green-100 text-green-700 border-green-300", hoverStatus: "Ready For Dispatch" },
  { key: "completedToday", label: "Completed Today", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700 border-emerald-300", hoverStatus: "completed-today" },
  { key: "delayedOrders", label: "Delayed Orders", icon: AlertTriangle, color: "bg-red-100 text-red-700 border-red-300", hoverStatus: "delayed" },
];

export default function ProductionDashboard() {
  const { data: user, isLoading: userLoading } = useGetMe();
  const [, setLocation] = useLocation();

  const { data: kpi, isLoading } = useQuery({
    queryKey: ["production-dashboard"],
    queryFn: () => customFetch<any>("/production/dashboard"),
    enabled: !!user,
  });

  if (userLoading || isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of all production orders</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATUS_CARDS.map((card) => {
          const count = kpi?.[card.key] ?? 0;
          const Icon = card.icon;
          return (
            <Card
              key={card.key}
              className="cursor-pointer hover:shadow-md transition-shadow border-2 border-transparent hover:border-primary/20"
              onClick={() => {
                const params = new URLSearchParams();
                if (card.hoverStatus === "in-production") {
                  params.set("status", "Production Started");
                } else if (card.hoverStatus === "completed-today") {
                  params.set("completedToday", "true");
                } else if (card.hoverStatus === "delayed") {
                  params.set("delayed", "true");
                } else {
                  params.set("status", card.hoverStatus);
                }
                setLocation(`/production/orders?${params.toString()}`);
              }}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {kpi && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Orders</span>
                <p className="text-2xl font-bold mt-1">{kpi.totalOrders}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Active Orders</span>
                <p className="text-2xl font-bold mt-1">
                  {kpi.totalOrders - (kpi.pendingCount + kpi.completedToday + (kpi.delayedOrders))}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Completed Today</span>
                <p className="text-2xl font-bold mt-1 text-green-600">{kpi.completedToday}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Delayed</span>
                <p className="text-2xl font-bold mt-1 text-red-600">{kpi.delayedOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
