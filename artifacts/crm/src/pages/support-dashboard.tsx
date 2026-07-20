import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Users, DollarSign, RefreshCw, AlertTriangle, Truck, Package, CheckCircle2, Ship } from "lucide-react";

const defaultDashboard = {
  totalRepeatOrders: 0,
  repeatOrdersThisMonth: 0,
  totalRepeatRevenue: 0,
  repeatRevenueThisMonth: 0,
  repeatCustomers: 0,
  activeComplaints: 0,
  pendingDispatch: 0,
  inProduction: 0,
  readyForDispatch: 0,
  inTransport: 0,
  collections: {
    repeatOrders: [],
    pendingDispatch: [],
    complaints: [],
    productionOrders: [],
    customers: [],
  },
  stats: {
    repeatRevenue: 0,
    repeatCustomers: 0,
    pendingDispatch: 0,
    inProduction: 0,
  },
};

export default function SupportDashboardPage() {
  const [, setLocation] = useLocation();

  const { data: dash = defaultDashboard, isLoading } = useQuery({
    queryKey: ["support-dashboard-kpi"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/support-kpi", {
        headers: { Authorization: "Bearer " + localStorage.getItem("crm_token") },
      });
      if (!res.ok) return defaultDashboard;
      return res.json();
    },
    staleTime: 30_000,
  });

  const stats = dash.stats || defaultDashboard.stats;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading support dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Support Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of support operations</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5 px-3 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
          </span>
          Live
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Orders</CardTitle>
            <RefreshCw className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dash.totalRepeatOrders ?? 0}</div>
            <p className="text-xs text-muted-foreground">+{dash.repeatOrdersThisMonth ?? 0} this month</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(dash.totalRepeatRevenue ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{(dash.repeatRevenueThisMonth ?? 0).toLocaleString()} this month</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Customers</CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dash.repeatCustomers ?? 0}</div>
            <p className="text-xs text-muted-foreground">Unique customers with repeat orders</p>
          </CardContent>
        </Card>

        <Card className="h-full rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Complaints</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{dash.activeComplaints ?? 0}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="h-full border-green-200 rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
          onClick={() => setLocation("/production/orders?status=Ready For Dispatch")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Ready for Dispatch</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-green-600">{dash.readyForDispatch ?? 0}</div>
          </CardContent>
        </Card>

        <Card
          className="h-full border-indigo-200 rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
          onClick={() => setLocation("/production/orders?status=In Transport")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">In Transport</CardTitle>
            <Ship className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-indigo-600">{dash.inTransport ?? 0}</div>
          </CardContent>
        </Card>

        <Card
          className="h-full border-orange-200 rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
          onClick={() => setLocation("/production/orders?status=Pending")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Pending Dispatch</CardTitle>
            <Truck className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-orange-600">{dash.pendingDispatch ?? 0}</div>
          </CardContent>
        </Card>

        <Card
          className="h-full border-purple-200 rounded-xl border bg-card text-card-foreground shadow hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out cursor-pointer"
          onClick={() => setLocation("/production/orders?status=In Production")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">In Production</CardTitle>
            <Package className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-purple-600">{dash.inProduction ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {dash.collections && dash.collections.repeatOrders && dash.collections.repeatOrders.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Recent Repeat Orders ({dash.collections.repeatOrders.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dash.collections.repeatOrders.map((order: any, i: number) => (
              <div key={i} className="text-sm text-muted-foreground">{order.orderNumber || order.id} - ₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {dash.collections && dash.collections.complaints && dash.collections.complaints.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Open Complaints ({dash.collections.complaints.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dash.collections.complaints.map((c: any, i: number) => (
              <div key={i} className="text-sm text-muted-foreground">{c.complaintNumber || c.id} - {c.complaintType} ({c.status})</div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <a href="/existing-customers" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-blue-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-blue-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-blue-700">Customers</CardTitle>
                <Users className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">View existing customers</p>
              </CardContent>
            </Card>
          </a>

          <a href="/complaints" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-red-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-red-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-red-700">Complaints</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Manage complaints</p>
              </CardContent>
            </Card>
          </a>

          <a href="/proforma-invoices" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-green-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-green-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-green-700">Proforma Invoices</CardTitle>
                <DollarSign className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Create and manage PIs</p>
              </CardContent>
            </Card>
          </a>

          <a href="/dispatch" className="block hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
            <Card className="h-full border-orange-200 rounded-xl border bg-card text-card-foreground shadow hover:bg-orange-50/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-orange-700">Dispatch</CardTitle>
                <Truck className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Track dispatches</p>
              </CardContent>
            </Card>
          </a>
        </div>
      </div>
    </div>
  );
}
