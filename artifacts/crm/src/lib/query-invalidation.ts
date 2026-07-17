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

export function onProductionChange(queryClient: QueryClient, orderId?: string, dealId?: number, contactId?: number) {
  queryClient.invalidateQueries({ queryKey: ["production-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["production-orders"] });
  queryClient.invalidateQueries({ queryKey: ["production-pending-summary"] });
  queryClient.invalidateQueries({ queryKey: ["production-progress-by-deal"] });
  if (orderId) {
    queryClient.invalidateQueries({ queryKey: ["production-order", orderId] });
  }
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
    queryClient.invalidateQueries({ queryKey: ["production-progress-by-deal", dealId] });
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
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
  }
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: ["timeline", contactId] });
    queryClient.invalidateQueries({ queryKey: ["deal-info", contactId] });
  }
}
