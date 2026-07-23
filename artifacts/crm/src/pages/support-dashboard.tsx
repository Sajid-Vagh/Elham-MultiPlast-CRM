import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Users, DollarSign, RefreshCw, AlertTriangle, Truck, Package, CheckCircle2, ClipboardList } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

export default function SupportDashboardPage() {
  const [, setLocation] = useLocation();

  const { data: dash, isLoading } = useQuery({
    queryKey: ["support-dashboard-kpi"],
    queryFn: () => customFetch<any>("/dashboard/support-kpi"),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading support dashboard...</div>
      </div>
    );
  }

  const d = dash || {};

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Support Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of support & dispatch operations</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5 px-3 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
          </span>
          Live
        </Badge>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Orders</CardTitle>
            <RefreshCw className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d.totalRepeatOrders ?? 0}</div>
            <p className="text-xs text-muted-foreground">+{d.repeatOrdersThisMonth ?? 0} this month</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(d.totalRepeatRevenue ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{(d.repeatRevenueThisMonth ?? 0).toLocaleString()} this month</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Customers</CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d.repeatCustomers ?? 0}</div>
            <p className="text-xs text-muted-foreground">Unique customers with repeat orders</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Complaints</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{d.activeComplaints ?? 0}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Dispatch Workflow KPIs */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Dispatch Workflow</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card
            className="h-full border-amber-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/dispatch?status=Pending Dispatch")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Pending Dispatch</CardTitle>
              <ClipboardList className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-amber-600">{d.pendingDispatch ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Ready for dispatch team</p>
            </CardContent>
          </Card>

          <Card
            className="h-full border-blue-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/dispatch?status=Load Vehicle")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Load Vehicle</CardTitle>
              <Truck className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-blue-600">{d.loadVehicle ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Vehicle assigned, loading</p>
            </CardContent>
          </Card>

          <Card
            className="h-full border-purple-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/dispatch?status=Dispatch")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Dispatched</CardTitle>
              <Package className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-purple-600">{d.dispatched ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">In transit</p>
            </CardContent>
          </Card>

          <Card
            className="h-full border-emerald-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/dispatch?status=Delivered")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Delivered</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-emerald-600">{d.delivered ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Completed deliveries</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* In Production (informational) */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Production Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card
            className="h-full border-orange-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/production/orders?status=Production On Going")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">In Production</CardTitle>
              <Package className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-orange-600">{d.inProduction ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Orders being manufactured</p>
            </CardContent>
          </Card>

          <Card
            className="h-full border-green-200 rounded-xl bg-card shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
            onClick={() => setLocation("/production/orders?status=Ready To Dispatch")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Ready To Dispatch</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-green-600">{d.readyForDispatch ?? 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Awaiting dispatch</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Repeat Orders */}
      {d.collections?.repeatOrders?.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Recent Repeat Orders ({d.collections.repeatOrders.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.collections.repeatOrders.map((order: any, i: number) => (
              <div key={i} className="text-sm text-muted-foreground">
                {order.orderNumber || order.id} — ₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Open Complaints */}
      {d.collections?.complaints?.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Open Complaints ({d.collections.complaints.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.collections.complaints.map((c: any, i: number) => (
              <div key={i} className="text-sm text-muted-foreground">
                {c.complaintNumber || c.id} — {c.complaintType} ({c.status})
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <a href="/dispatch" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-amber-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-amber-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-amber-700">Dispatch</CardTitle>
                <Truck className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent><p className="text-xs text-muted-foreground">Manage dispatch workflow</p></CardContent>
            </Card>
          </a>

          <a href="/existing-customers" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-blue-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-blue-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-blue-700">Customers</CardTitle>
                <Users className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent><p className="text-xs text-muted-foreground">View existing customers</p></CardContent>
            </Card>
          </a>

          <a href="/complaints" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-red-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-red-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-red-700">Complaints</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent><p className="text-xs text-muted-foreground">Manage complaints</p></CardContent>
            </Card>
          </a>

          <a href="/proforma-invoices" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-green-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-green-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-green-700">Proforma Invoices</CardTitle>
                <DollarSign className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent><p className="text-xs text-muted-foreground">Create and manage PIs</p></CardContent>
            </Card>
          </a>
        </div>
      </div>
    </div>
  );
}
