import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { ExportDropdown } from "@/components/export-dropdown";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Material Ready": "bg-blue-100 text-blue-700 border-blue-300",
  "Production Started": "bg-orange-100 text-orange-700 border-orange-300",
  "In Process": "bg-purple-100 text-purple-700 border-purple-300",
  "Quality Check": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Packing": "bg-cyan-100 text-cyan-700 border-cyan-300",
  "Ready For Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "On Hold": "bg-gray-100 text-gray-500 border-gray-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-gray-100 text-gray-600",
  Medium: "bg-blue-100 text-blue-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
};

export default function ProductionOrders() {
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);

  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get("priority") || "all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [createdByFilter, setCreatedByFilter] = useState("all");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [page, setPage] = useState(1);

  const showUnitFilter = true;
  const canSeeAll = user?.role === "admin" || user?.unit === "All";
  const PRODUCTION_UNITS = canSeeAll
    ? ["All", "Himatnagar", "Surat", "Rajkot"]
    : ["Himatnagar", "Surat", "Rajkot"];

  useEffect(() => {
    if (user && user.unit && user.unit !== "All" && user.role !== "admin") {
      setUnitFilter(user.unit.toLowerCase());
    }
  }, [user]);

  const { data: usersList } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => customFetch<any[]>("/users"),
    enabled: !!user,
  });

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: "15" };
    if (statusFilter !== "all") p.status = statusFilter;
    if (priorityFilter !== "all") p.priority = priorityFilter;
    if (unitFilter !== "all") p.unit = unitFilter;
    if (createdByFilter !== "all") p.createdBy = createdByFilter;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [statusFilter, priorityFilter, unitFilter, createdByFilter, search, page]);

  const { data, isLoading } = useQuery({
    queryKey: ["production-orders", queryParams],
    queryFn: () => customFetch<any>(`/production/orders?${new URLSearchParams(queryParams)}`),
    enabled: !!user,
  });

  const orders = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Production Orders</h1>
        <ExportDropdown exportUrl="/api/exports/production" filename="Production_Orders" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer, invoice, mobile..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Material Ready">Material Ready</SelectItem>
            <SelectItem value="Production Started">Production Started</SelectItem>
            <SelectItem value="In Process">In Process</SelectItem>
            <SelectItem value="Quality Check">Quality Check</SelectItem>
            <SelectItem value="Packing">Packing</SelectItem>
            <SelectItem value="Ready For Dispatch">Ready For Dispatch</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
            <SelectItem value="On Hold">On Hold</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Priorities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>

        {showUnitFilter && (
          <Select value={unitFilter} onValueChange={(v) => { setUnitFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Select Unit" /></SelectTrigger>
            <SelectContent>
              {PRODUCTION_UNITS.map((u) => (
                <SelectItem key={u} value={u.toLowerCase()}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={createdByFilter} onValueChange={(v) => { setCreatedByFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Users" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            <SelectItem value="sales">Sales Users</SelectItem>
            <SelectItem value="production_and_support">Prod & Support Users</SelectItem>
            {usersList?.filter((u: any) => u.role === "sales" || u.role === "production_and_support").map((u: any) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No production orders found
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Production ID</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Bottle Size</TableHead>
                  <TableHead>Bottle Color</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Production Unit</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Exp. Dispatch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order: any) => {
                  const firstItem = order.items?.[0];
                  return (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setLocation(`/production/orders/${order.id}`)}
                    >
                      <TableCell className="font-mono text-xs">#{order.id}</TableCell>
                      <TableCell className="font-mono text-xs">{order.invoice?.invoiceNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{order.invoice?.companyName || order.invoice?.customerName || "-"}</TableCell>
                      <TableCell>{firstItem?.productName || "-"}</TableCell>
                      <TableCell>{firstItem?.capacity || firstItem?.weight || "-"}</TableCell>
                      <TableCell>{firstItem?.bottleType || "-"}</TableCell>
                      <TableCell>{firstItem ? Number(firstItem.quantity).toFixed(2) : "-"}</TableCell>
                      <TableCell>
                        {order.productionUnit ? (
                          <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200">{order.productionUnit}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {order.createdByName ? (
                          <div className="text-xs">
                            <span className="font-medium">{order.createdByName}</span>
                            {order.createdByRole && (
                              <Badge variant="outline" className="ml-1 text-[10px] py-0">
                                {order.createdByRole === "production_and_support" ? "Production & Support" : "Sales"}
                              </Badge>
                            )}
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${PRIORITY_COLORS[order.priority] || "bg-gray-100"} border-0`}>
                          {order.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN") : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {order.expectedDispatchDate ? new Date(order.expectedDispatchDate).toLocaleDateString("en-IN") : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${STATUS_COLORS[order.status] || "bg-gray-100"} border whitespace-nowrap`} variant="outline">
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {order.updatedAt ? new Date(order.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({data?.total || 0} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
