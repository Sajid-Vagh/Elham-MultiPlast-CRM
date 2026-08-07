import { QueryClient } from "@tanstack/react-query";
import {
  getListContactsQueryKey,
  getGetContactQueryKey,
  getListDealsQueryKey,
  getGetDealQueryKey,
  getListActivitiesQueryKey,
  getListDealProductsQueryKey,
  getListProductsQueryKey,
  getListUsersQueryKey,
  getGetMeQueryKey,
  getListContactProformaInvoicesQueryKey,
} from "@workspace/api-client-react";

export function onContactChange(queryClient: QueryClient, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
  queryClient.invalidateQueries({ queryKey: ["category-counts"] });
  queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
  queryClient.invalidateQueries({ queryKey: ["contacts-search"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-kpi"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-sales-performance"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-charts"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  queryClient.invalidateQueries({ queryKey: ["all-contacts-counts"] });
  queryClient.invalidateQueries({ queryKey: ["users-list"] });
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    queryClient.invalidateQueries({ queryKey: ["upcoming-followup", contactId] });
    queryClient.invalidateQueries({ queryKey: ["deal-info", contactId] });
    queryClient.invalidateQueries({ queryKey: ["category-history", contactId] });
    queryClient.invalidateQueries({ queryKey: ["comment-history", contactId] });
    queryClient.invalidateQueries({ queryKey: ["contact-notifications", contactId] });
  }
}

export function onDealChange(queryClient: QueryClient, dealId?: number, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
  queryClient.invalidateQueries({ queryKey: ["category-counts"] });
  queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-kpi"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-sales-performance"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-charts"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  queryClient.invalidateQueries({ queryKey: ["global-search"] });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListDealProductsQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
    queryClient.invalidateQueries({ queryKey: ["voice-notes", "deal", dealId] });
  }
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    queryClient.invalidateQueries({ queryKey: ["deal-info", contactId] });
    queryClient.invalidateQueries({ queryKey: ["upcoming-followup", contactId] });
    queryClient.invalidateQueries({ queryKey: ["category-history", contactId] });
  }
}

export function onActivityChange(queryClient: QueryClient, dealId?: number, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: ["follow-up-activities"] });
  queryClient.invalidateQueries({ queryKey: ["category-counts"] });
  queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-kpi"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
    queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["voice-notes", "deal", dealId] });
  }
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    queryClient.invalidateQueries({ queryKey: ["upcoming-followup", contactId] });
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: ["deal-info", contactId] });
  }
}

export function onProductChange(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
}

export function onUserChange(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  queryClient.invalidateQueries({ queryKey: ["users-list"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-sales-performance"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  queryClient.invalidateQueries({ queryKey: ["reports-by-owner"] });
  queryClient.invalidateQueries({ queryKey: ["category-report"] });
}

// Immediately propagate the current user's new data (e.g. a freshly uploaded
// profile photo) into the global "me" query so the Header, Sidebar and every
// UserAvatar re-render instantly instead of waiting for a refetch.
export function syncMe(queryClient: QueryClient, data: unknown) {
  const d = data as { user?: Record<string, unknown>; profilePhoto?: string | null };
  const base = d?.user ?? data;
  if (!base) return;
  // Prefer the explicit profilePhoto returned by the upload/remove endpoint so
  // the global "me" state always reflects the exact permanent URL the backend
  // persisted (never a stale or absent field nested inside the user object).
  const updated =
    d?.profilePhoto !== undefined
      ? { ...(base as Record<string, unknown>), profilePhoto: d.profilePhoto }
      : base;
  queryClient.setQueryData(getGetMeQueryKey(), updated);
  onUserChange(queryClient);
}

export function onProductionChange(queryClient: QueryClient, orderId?: string, dealId?: number, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: ["production-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["production-orders"] });
  queryClient.invalidateQueries({ queryKey: ["production-pending-summary"] });
  queryClient.invalidateQueries({ queryKey: ["machine-report"] });
  queryClient.invalidateQueries({ queryKey: ["production-progress-by-deal"] });
  queryClient.invalidateQueries({ queryKey: ["support-dashboard-kpi"] });
  queryClient.invalidateQueries({ queryKey: ["dispatch-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
  if (orderId) {
    queryClient.invalidateQueries({ queryKey: ["production-order", orderId] });
    queryClient.invalidateQueries({ queryKey: ["voice-notes", "production", Number(orderId)] });
  }
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
    queryClient.invalidateQueries({ queryKey: ["production-progress-by-deal", dealId] });
    queryClient.invalidateQueries({ queryKey: ["voice-notes", "deal", dealId] });
  }
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: ["production-by-contact", contactId] });
  }
  queryClient.invalidateQueries({ queryKey: ["follow-up-activities"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
}

export function onPIChange(queryClient: QueryClient, dealId?: number, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: ["proforma-invoices"] });
  queryClient.invalidateQueries({ queryKey: ["global-search"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-kpi"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-sales-performance"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-charts"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  queryClient.invalidateQueries({ queryKey: ["reports-summary"] });
  queryClient.invalidateQueries({ queryKey: ["reports-by-owner"] });
  queryClient.invalidateQueries({ queryKey: ["reports-pipeline"] });
  queryClient.invalidateQueries({ queryKey: ["reports-by-city"] });
  // PI revisions can add items to / revert the status of linked production
  // orders — invalidate all production surfaces so the Order Items list and
  // the production dashboard reflect the synced items immediately.
  queryClient.invalidateQueries({ queryKey: ["production-order"] });
  queryClient.invalidateQueries({ queryKey: ["production-orders"] });
  queryClient.invalidateQueries({ queryKey: ["production-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["production-pending-summary"] });
  queryClient.invalidateQueries({ queryKey: ["production-progress-by-deal"] });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
  }
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    queryClient.invalidateQueries({ queryKey: ["deal-info", contactId] });
    queryClient.invalidateQueries({ queryKey: getListContactProformaInvoicesQueryKey(contactId) });
  }
}

export function onMasterChange(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["transport-destinations"] });
  queryClient.invalidateQueries({ queryKey: ["product-bundles"] });
  queryClient.invalidateQueries({ queryKey: ["transport-destinations-lookup"] });
  queryClient.invalidateQueries({ queryKey: ["product-bundles-lookup"] });
  queryClient.invalidateQueries({ queryKey: ["transport-lookup"] });
  queryClient.invalidateQueries({ queryKey: ["import-last", "transport_master"] });
  queryClient.invalidateQueries({ queryKey: ["import-last", "packing_master"] });
}
