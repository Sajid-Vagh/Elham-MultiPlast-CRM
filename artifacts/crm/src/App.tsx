import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Settings from "@/pages/settings";
import CategoriesPage from "@/pages/categories";
import ProformaInvoices from "@/pages/proforma-invoices";
import NotificationsPage from "@/pages/notifications";
import ProductionDashboard from "@/pages/production-dashboard";
import ProductionOrders from "@/pages/production-orders";
import ProductionOrderDetail from "@/pages/production-order-detail";

import MachineReport from "@/pages/machine-report";
import DispatchPage from "@/pages/dispatch";
import ExistingCustomers from "@/pages/existing-customers";
import ExistingCustomerDetail from "@/pages/existing-customer-detail";
import GlobalSearch from "@/pages/global-search";
import SupportDashboard from "@/pages/support-dashboard";
import TransportLogistics from "@/pages/transport-logistics";
import TransportLogisticsLookup from "@/pages/transport-logistics-readonly";
import MastersPage from "@/pages/masters";
import Inventory from "@/pages/inventory";
import OrdersList from "@/pages/orders-list";
import OrderDetailGlobal from "@/pages/order-detail-global";
import { readWorkspace, getHomeRoute } from "@/lib/use-workspace";
import { GlobalFilterProvider } from "@/lib/global-filters";
import { ProductionFilterProvider } from "@/lib/production-filters";

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
  const role = localStorage.getItem("crm_user_role") ?? "";

  if (!allowedRoles.includes(role)) {
    setLocation(getHomeRoute(readWorkspace(role)));
    return null;
  }

  return <>{children}</>;
}

// Workspace-accessible roles: production can access Sales, support can access all, sales can access Production
const SALES_ADMIN_ROLES = ["admin", "sales", "production", "production_and_support"];
const PRODUCTION_ROLES = ["admin", "production", "production_and_support", "sales"];
const SUPPORT_ROLES = ["admin", "sales", "production_and_support", "production"];
const SUPPORT_DASHBOARD_ROLES = ["admin", "production_and_support", "sales", "production"];
const INVENTORY_ROLES = ["admin", "sales", "inventory", "production", "production_and_support"];

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => {
          if (typeof window !== "undefined") {
            const token = localStorage.getItem("crm_token");
            const role = localStorage.getItem("crm_user_role");
            if (token && role) {
              window.location.replace(getHomeRoute(readWorkspace(role)));
            } else {
              window.location.replace("/login");
            }
          }
          return null;
        }}
      </Route>

      {/* Inventory routes (before parametrised routes to avoid conflicts) */}
      <Route path="/inventory">
        <ProtectedLayout>
          <RoleGuard allowedRoles={INVENTORY_ROLES}><Inventory /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Support Dashboard */}
      <Route path="/support-dashboard">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_DASHBOARD_ROLES}><SupportDashboard /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Sales & Admin routes */}
      <Route path="/dashboard">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><Dashboard /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/leads/new">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><LeadsNew /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/leads/:id/edit">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><LeadsEdit /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/leads/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={[...SALES_ADMIN_ROLES, "production_and_support"]}><LeadDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/leads">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><Leads /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/deals/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><DealDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/deals">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><Deals /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/follow-ups">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><FollowUps /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/categories">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><CategoriesPage /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/reports">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><Reports /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/import">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><ImportPage /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Shared routes (all roles) */}
      <Route path="/products">
        <ProtectedLayout>
          <RoleGuard allowedRoles={[...SUPPORT_ROLES, "production"]}><Products /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/proforma-invoices">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><ProformaInvoices /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/settings">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales", "production", "production_and_support", "inventory"]}><Settings /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/notifications">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales", "production", "production_and_support", "inventory"]}><NotificationsPage /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/search">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><GlobalSearch /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Dispatch routes (Support, Admin) */}
      <Route path="/dispatch">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><DispatchPage /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Orders Module (all roles) */}
      <Route path="/orders/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales", "production_and_support", "production"]}><OrderDetailGlobal /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/orders">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales", "production_and_support", "production"]}><OrdersList /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Customer Profile — redirects to lead detail (consolidated) */}
      <Route path="/customers/:id">
        {(params) => {
          // Redirect to lead detail which has full Customer 360 Profile
          window.location.href = `/leads/${params.id}`;
          return <ProtectedLayout><div className="p-8 text-center text-muted-foreground">Redirecting...</div></ProtectedLayout>;
        }}
      </Route>

      {/* Existing Customers (Support + Admin) */}
      <Route path="/existing-customers/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><ExistingCustomerDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/existing-customers">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><ExistingCustomers /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Transport Logistics (legacy) */}
      <Route path="/transport-logistics/lookup">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><TransportLogisticsLookup /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/transport-logistics">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><TransportLogistics /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Masters page (transport, packing, import) */}
      <Route path="/masters">
        <ProtectedLayout>
          <RoleGuard allowedRoles={[...SUPPORT_ROLES, "production"]}><MastersPage /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Production routes */}
      <Route path="/production/dashboard">
        <ProtectedLayout>
          <RoleGuard allowedRoles={PRODUCTION_ROLES}><ProductionDashboard /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/production/orders/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={PRODUCTION_ROLES}><ProductionOrderDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/production/orders">
        <ProtectedLayout>
          <RoleGuard allowedRoles={PRODUCTION_ROLES}><ProductionOrders /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/production/machine-report">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "production_and_support", "production"]}><MachineReport /></RoleGuard>
        </ProtectedLayout>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalFilterProvider>
        <ProductionFilterProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
        </ProductionFilterProvider>
      </GlobalFilterProvider>
    </QueryClientProvider>
  );
}

export default App;
