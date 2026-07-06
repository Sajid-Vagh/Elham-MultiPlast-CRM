import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Leads from "@/pages/leads";
import LeadsNew from "@/pages/leads-new";
import LeadsEdit from "@/pages/leads-edit";
import LeadDetail from "@/pages/lead-detail";
import Deals from "@/pages/deals";
import DealDetail from "@/pages/deal-detail";
import FollowUps from "@/pages/follow-ups";
import Products from "@/pages/products";
import Reports from "@/pages/reports";
import ImportPage from "@/pages/import";
import Duplicates from "@/pages/duplicates";
import Settings from "@/pages/settings";
import CategoriesPage from "@/pages/categories";
import ProformaInvoices from "@/pages/proforma-invoices";
import ProductionDashboard from "@/pages/production-dashboard";
import ProductionOrders from "@/pages/production-orders";
import ProductionOrderDetail from "@/pages/production-order-detail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary><Layout>{children}</Layout></ErrorBoundary>;
}

function RoleGuard({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useQuery({
    queryKey: ["get-me"],
    enabled: false,
  });

  if (isLoading) return null;

  const role = (user as any)?.role ?? localStorage.getItem("crm_user_role");

  if (!allowedRoles.includes(role)) {
    if (role === "production_manager") {
      setLocation("/production/dashboard");
    } else {
      setLocation("/dashboard");
    }
    return null;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => {
          if (typeof window !== "undefined") {
            const token = localStorage.getItem("crm_token");
            const role = localStorage.getItem("crm_user_role");
            if (token) {
              window.location.replace(role === "production_manager" ? "/production/dashboard" : "/dashboard");
            } else {
              window.location.replace("/login");
            }
          }
          return null;
        }}
      </Route>
      <Route path="/dashboard">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Dashboard /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/leads/new">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><LeadsNew /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/leads/:id/edit">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><LeadsEdit /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/leads/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><LeadDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/leads">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Leads /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/deals/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><DealDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/deals">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Deals /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/follow-ups">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><FollowUps /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/products">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Products /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/categories">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><CategoriesPage /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/proforma-invoices">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><ProformaInvoices /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/reports">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Reports /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/import">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><ImportPage /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/duplicates">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales"]}><Duplicates /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/settings">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin"]}><Settings /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/production/dashboard">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["production_manager", "admin"]}><ProductionDashboard /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/production/orders/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={["production_manager", "admin"]}><ProductionOrderDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/production/orders">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["production_manager", "admin"]}><ProductionOrders /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
