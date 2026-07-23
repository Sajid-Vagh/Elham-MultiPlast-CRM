import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, ArrowLeft, ArrowRight } from "lucide-react";
import { useUserUnits } from "@/lib/use-user-units";
import { useActiveUnits } from "@/lib/use-active-units";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
  "Packaging": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready To Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  "Low": "bg-gray-100 text-gray-600",
  "Medium": "bg-blue-100 text-blue-700",
  "High": "bg-orange-100 text-orange-700",
  "Urgent": "bg-red-100 text-red-700",
};

const STATUSES = [
  "all", "Pending", "Production On Going", "Packaging",
  "Ready To Dispatch", "Completed", "Cancelled",
];

export default function ProductionOrders() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const { units: userUnits, userUnit, locked } = useUserUnits();
  const [selectedUnit, setSelectedUnit] = useState<string>(userUnit);

  const [status, setStatus] = useState(params.get("status") || "all");
  const [priority, setPriority] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [search, setSearch] = useState(params.get("search") || "");
  const [page, setPage] = useState(Number(params.get("page")) || 1);

  const buildUrl = () => {
    const p: Record<string, string> = {};
    if (status !== "all") p.status = status;
    if (priority !== "all") p.priority = priority;
    if (origin !== "all") p.origin = origin;
    if (selectedUnit && selectedUnit !== "All") p.unit = selectedUnit;
    if (search) p.search = search;
    p.page = String(page);
    p.limit = "15";
    return "/production/orders?" + new URLSearchParams(p).toString();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["production-orders", status, priority, origin, selectedUnit, search, page],
    queryFn: () => customFetch<any>(buildUrl()),
    enabled: !!user,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track all production orders</p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/production/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer, company, invoice..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>

        <Select value={origin} onValueChange={(v) => { setOrigin(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Origin" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Origins</SelectItem>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="production_and_support">Support</SelectItem>
          </SelectContent>
        </Select>

        {!locked && userUnits.length > 1 && (
          <Select value={selectedUnit} onValueChange={(v) => { setSelectedUnit(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Unit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Units</SelectItem>
              {userUnits.filter(u => u !== "All").map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {data ? `${data.total} order${data.total !== 1 ? "s" : ""} found` : "Loading..."}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !data?.data?.length ? (
            <div className="py-12 text-center text-muted-foreground">No production orders found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">ID</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Customer</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Product</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Origin</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Unit</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Created By</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Priority</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((order: any) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setLocation(`/production/orders/${order.id}`)}
                    >
                      <td className="py-3 px-4 font-medium">#{order.id}</td>
                      <td className="py-3 px-4 max-w-[180px] truncate">
                        {order.invoice?.companyName || order.invoice?.customerName || "-"}
                      </td>
                      <td className="py-3 px-4 max-w-[150px] truncate">
                        {order.items?.[0]?.productName || "-"}
                      </td>
                      <td className="py-3 px-4">
                        {order.createdByRole ? (
                          <Badge variant="outline" className={`text-[10px] ${order.createdByRole === "production_and_support" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                            {order.createdByRole === "production_and_support" ? "SUPPORT" : "SALES"}
                          </Badge>
                        ) : "-"}
                      </td>
                      <td className="py-3 px-4">{order.productionUnit || "-"}</td>
                      <td className="py-3 px-4">{order.createdByName || "-"}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[order.priority] || "bg-gray-100"} border-0`}>
                          {order.priority}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.status] || "bg-gray-100"} border`}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
