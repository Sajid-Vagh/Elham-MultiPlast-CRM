import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportDropdown } from "@/components/export-dropdown";
import { Search, Users, Factory, Truck, AlertTriangle, Clock, CheckCircle2, XCircle, Phone } from "lucide-react";

const EXISTING_CUSTOMER_STATUSES = ["All", "Active", "Production Running", "Dispatch Pending", "Repeat Order Due", "Complaint Open", "Inactive"];

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-700",
  "Production Running": "bg-purple-100 text-purple-700",
  "Dispatch Pending": "bg-cyan-100 text-cyan-700",
  "Repeat Order Due": "bg-amber-100 text-amber-700",
  "Complaint Open": "bg-red-100 text-red-700",
  "Inactive": "bg-gray-100 text-gray-500",
};

const KPI_CARDS = [
  { key: "totalCustomers", label: "Total Customers", icon: Users, color: "bg-indigo-100 text-indigo-700 border-indigo-300" },
  { key: "activeCustomers", label: "Active", icon: CheckCircle2, color: "bg-green-100 text-green-700 border-green-300" },
  { key: "productionRunning", label: "Production Running", icon: Factory, color: "bg-purple-100 text-purple-700 border-purple-300" },
  { key: "dispatchPending", label: "Dispatch Pending", icon: Truck, color: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  { key: "complaintPending", label: "Complaints Open", icon: AlertTriangle, color: "bg-red-100 text-red-700 border-red-300" },
  { key: "repeatOrderDue", label: "Repeat Order Due", icon: Clock, color: "bg-amber-100 text-amber-700 border-amber-300" },
  { key: "inactiveCustomers", label: "Inactive", icon: XCircle, color: "bg-gray-100 text-gray-600 border-gray-300" },
  { key: "customersToCallToday", label: "To Call Today", icon: Phone, color: "bg-blue-100 text-blue-700 border-blue-300" },
];

export default function ExistingCustomers() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);

  const { data: kpi, isLoading: kpiLoading } = useQuery({
    queryKey: ["existing-customers-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/existing-customers/dashboard", {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["existing-customers", { search, status: statusFilter, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "All") params.set("status", statusFilter);
      params.set("page", String(page));
      const res = await fetch(`/api/existing-customers?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Existing Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and view all existing customers</p>
        </div>
        <ExportDropdown exportUrl="/api/exports/existing-customers" filename="Existing_Customers" />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {KPI_CARDS.map((card) => {
          const count = kpi?.[card.key] ?? 0;
          const Icon = card.icon;
          return (
            <Card key={card.key} className="border-2 border-transparent hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
                    {kpiLoading ? (
                      <Skeleton className="h-8 w-16 mt-1" />
                    ) : (
                      <p className="text-2xl font-bold mt-1">{count}</p>
                    )}
                  </div>
                  <div className={`p-2 rounded-lg ${card.color.split(" ").slice(0, 2).join(" ")}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, company, mobile..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {EXISTING_CUSTOMER_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Orders</TableHead>
                <TableHead>Total Revenue</TableHead>
                <TableHead>Last Order</TableHead>
                <TableHead>Sales Owner</TableHead>
                <TableHead>Support Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No customers found</TableCell></TableRow>
              ) : (
                data?.data?.map((ec: any) => (
                  <TableRow
                    key={ec.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => setLocation(`/existing-customers/${ec.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{ec.contact?.name || "-"}</p>
                        {ec.contact?.companyName && (
                          <p className="text-xs text-muted-foreground">{ec.contact.companyName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>
                        <p>{ec.contact?.mobile || "-"}</p>
                        {ec.contact?.city && <p className="text-xs text-muted-foreground">{ec.contact.city}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[ec.status] || "bg-gray-100"}>
                        {ec.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">{ec.totalOrders}</TableCell>
                    <TableCell className="font-medium">₹{Number(ec.totalRevenue || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-sm">
                      {ec.lastOrder ? (
                        <div>
                          <p className="font-medium">{ec.lastOrder.orderNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            ₹{Number(ec.lastOrder.grandTotal || 0).toLocaleString("en-IN")}
                          </p>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-sm">{ec.salesOwner?.name || "-"}</TableCell>
                    <TableCell className="text-sm">{ec.supportOwner?.name || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} customers)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}