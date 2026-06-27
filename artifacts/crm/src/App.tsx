import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => {
          if (typeof window !== "undefined") {
            window.location.replace(localStorage.getItem("crm_token") ? "/dashboard" : "/login");
          }
          return null;
        }}
      </Route>
      <Route path="/dashboard">
        <ProtectedLayout><Dashboard /></ProtectedLayout>
      </Route>
      <Route path="/leads/new">
        <ProtectedLayout><LeadsNew /></ProtectedLayout>
      </Route>
      <Route path="/leads/:id/edit">
        {(params) => <ProtectedLayout><LeadsEdit /></ProtectedLayout>}
      </Route>
      <Route path="/leads/:id">
        {(params) => <ProtectedLayout><LeadDetail /></ProtectedLayout>}
      </Route>
      <Route path="/leads">
        <ProtectedLayout><Leads /></ProtectedLayout>
      </Route>
      <Route path="/deals/:id">
        {(params) => <ProtectedLayout><DealDetail /></ProtectedLayout>}
      </Route>
      <Route path="/deals">
        <ProtectedLayout><Deals /></ProtectedLayout>
      </Route>
      <Route path="/follow-ups">
        <ProtectedLayout><FollowUps /></ProtectedLayout>
      </Route>
      <Route path="/products">
        <ProtectedLayout><Products /></ProtectedLayout>
      </Route>
      <Route path="/categories">
        <ProtectedLayout><CategoriesPage /></ProtectedLayout>
      </Route>
      <Route path="/proforma-invoices">
        <ProtectedLayout><ProformaInvoices /></ProtectedLayout>
      </Route>
      <Route path="/reports">
        <ProtectedLayout><Reports /></ProtectedLayout>
      </Route>
      <Route path="/import">
        <ProtectedLayout><ImportPage /></ProtectedLayout>
      </Route>
      <Route path="/duplicates">
        <ProtectedLayout><Duplicates /></ProtectedLayout>
      </Route>
      <Route path="/settings">
        <ProtectedLayout><Settings /></ProtectedLayout>
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
