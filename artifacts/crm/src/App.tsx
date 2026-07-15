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
import Duplicates from "@/pages/duplicates";
import Settings from "@/pages/settings";
import CategoriesPage from "@/pages/categories";
import ProformaInvoices from "@/pages/proforma-invoices";
import NotificationsPage from "@/pages/notifications";
import ProductionDashboard from "@/pages/production-dashboard";
import ProductionOrders from "@/pages/production-orders";
import ProductionOrderDetail from "@/pages/production-order-detail";

import Batches from "@/pages/batches";
import BatchDetail from "@/pages/batch-detail";
import MachineReport from "@/pages/machine-report";
import DispatchPage from "@/pages/dispatch";
import ComplaintsPage from "@/pages/complaints";
import CustomerProfile from "@/pages/customer-profile";
import ExistingCustomers from "@/pages/existing-customers";
import ExistingCustomerDetail from "@/pages/existing-customer-detail";
import GlobalSearch from "@/pages/global-search";
import TransportLogistics from "@/pages/transport-logistics";
import TransportLogisticsLookup from "@/pages/transport-logistics-readonly";

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
    if (role === "production") {
      setLocation("/production/dashboard");
    } else if (role === "production_and_support") {
      setLocation("/production/dashboard");
    } else {
      setLocation("/dashboard");
    }
    return null;
  }

  return <>{children}</>;
}

const SALES_ADMIN_ROLES = ["admin", "sales"];
const PRODUCTION_ROLES = ["production", "production_and_support", "admin"];
const SUPPORT_ROLES = ["admin", "sales", "production_and_support"];

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
              if (role === "production" || role === "production_and_support") {
                window.location.replace("/production/dashboard");
              } else {
                window.location.replace("/dashboard");
              }
            } else {
              window.location.replace("/login");
            }
          }
          return null;
        }}
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
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><LeadDetail /></RoleGuard>
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
      <Route path="/duplicates">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SALES_ADMIN_ROLES}><Duplicates /></RoleGuard>
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
          <RoleGuard allowedRoles={["admin", "sales", "production", "production_and_support"]}><Settings /></RoleGuard>
        </ProtectedLayout>
      </Route>
      <Route path="/notifications">
        <ProtectedLayout>
          <RoleGuard allowedRoles={["admin", "sales", "production", "production_and_support"]}><NotificationsPage /></RoleGuard>
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

      {/* Complaint routes (Support, Admin) */}
      <Route path="/complaints">
        <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><ComplaintsPage /></RoleGuard>
        </ProtectedLayout>
      </Route>

      {/* Customer Profile */}
      <Route path="/customers/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={SUPPORT_ROLES}><CustomerProfile /></RoleGuard>
        </ProtectedLayout>}
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

      {/* Transport Logistics */}
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
      <Route path="/production/batches/:id">
        {(params) => <ProtectedLayout>
          <RoleGuard allowedRoles={PRODUCTION_ROLES}><BatchDetail /></RoleGuard>
        </ProtectedLayout>}
      </Route>
      <Route path="/production/batches">
        <ProtectedLayout>
          <RoleGuard allowedRoles={PRODUCTION_ROLES}><Batches /></RoleGuard>
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
