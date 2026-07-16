import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Factory, PackageCheck, Settings2, ShieldCheck, Package, Truck, CheckCircle2, Clock, AlertTriangle, ListOrdered, BoxSelect } from "lucide-react";
import { useUserUnits } from "@/lib/use-user-units";
import { useProductionSyncAlert } from "@/lib/use-production-sync-alert";

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
  const { units: accessibleUnits, locked: unitLocked } = useUserUnits();
  const [unitFilter, setUnitFilter] = useState("all");

  useProductionSyncAlert(!!user);

  useEffect(() => {
    if (unitLocked && accessibleUnits.length === 1) {
      setUnitFilter(accessibleUnits[0].toLowerCase());
    }
  }, [unitLocked, accessibleUnits]);

  const { data: kpi, isLoading } = useQuery({
    queryKey: ["production-dashboard", unitFilter],
    queryFn: () => customFetch<any>(`/production/dashboard${unitFilter !== "all" ? `?unit=${unitFilter}` : ""}`),
    enabled: !!user,
    refetchInterval: 10_000,
  });

  const { data: pendingReqs, isLoading: reqsLoading } = useQuery({
    queryKey: ["production-pending-requirements", unitFilter],
    queryFn: () => customFetch<any[]>(`/production/pending-requirements${unitFilter !== "all" ? `?unit=${unitFilter}` : ""}`),
    enabled: !!user,
  });

  const { data: pendingSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["production-pending-summary", unitFilter],
    queryFn: () => customFetch<any>(`/production/pending-summary${unitFilter !== "all" ? `?unit=${unitFilter}` : ""}`),
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
        <div className="flex items-center gap-2">
          <Select value={unitFilter} onValueChange={setUnitFilter} disabled={unitLocked}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Select Unit" /></SelectTrigger>
            <SelectContent>
              {accessibleUnits.map((u) => (
                <SelectItem key={u} value={u.toLowerCase()}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unitLocked && <span className="text-xs text-muted-foreground">Locked to {accessibleUnits[0]}</span>}
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

      {/* Pending Production Summary Widget */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <BoxSelect className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-lg">Pending Production Summary</CardTitle>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-xs">
              {pendingSummary?.totalPendingProducts ?? 0} products
            </Badge>
            <Badge variant="outline" className="text-xs font-semibold text-purple-600">
              {(pendingSummary?.totalPendingPieces ?? 0).toLocaleString("en-IN")} total pcs
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !pendingSummary?.products?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No pending production quantities</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="text-right">Pending Quantity</TableHead>
                    <TableHead className="text-right">Active Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingSummary.products.map((p: any) => (
                    <TableRow key={p.productName}>
                      <TableCell className="font-medium">{p.productName}</TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold text-purple-600">
                          {p.totalPendingQuantity.toLocaleString("en-IN")} pcs
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.orderCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Production Requirements */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-lg">Pending Production Requirements</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {pendingReqs?.length ?? 0} items
          </Badge>
        </CardHeader>
        <CardContent>
          {reqsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !pendingReqs?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No pending production requirements</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Gramage</TableHead>
                    <TableHead className="text-right">Total Ordered</TableHead>
                    <TableHead className="text-right">Total Dispatched</TableHead>
                    <TableHead className="text-right">Pending to Produce</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingReqs.map((req: any, idx: number) => {
                    const pending = Number(req.pending || 0);
                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{req.productName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{req.gramage}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{Number(req.totalOrdered || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{Number(req.totalDispatched || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold ${pending > 0 ? "text-red-600" : "text-green-600"}`}>
                            {pending.toLocaleString("en-IN")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{req.orderCount}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
