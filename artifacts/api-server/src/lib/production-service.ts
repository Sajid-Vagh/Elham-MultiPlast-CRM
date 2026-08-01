import {
  db, productionOrdersTable, productionTimelineTable, productionNotesTable,
  productionMessagesTable, proformaInvoicesTable, proformaInvoiceItemsTable,
  usersTable, contactsTable, dealsTable, activitiesTable,
  productionAuditTrailTable, notificationsTable, productsTable,
  productionOrderItemsTable,
  PRODUCTION_STATUSES, VALID_STATUS_TRANSITIONS,
  VALID_DISPATCH_TRANSITIONS, PRODUCT_LINE_STATUSES,
  type ProductionStatus, type NoteType, type ProductLineStatus,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, or, inArray, notInArray, type SQL } from "drizzle-orm";
import { getActivePiForDeal } from "./proforma-service";
import { notifyProductionUsers, notifyDealEvent } from "./notification-service";
import { createNotification } from "../routes/notifications";
import { logActivity, formatTimestamp } from "./activity-logger";
import { canAccessProduction, type PermissionUser } from "./permission-service";
import { maskContactForProduction, maskInvoiceForProduction, isProductionOnlyRole } from "./customer-mask";
import { getFinancialYear } from "./order-id-generator";

export function isValidTransition(from: string, to: string): boolean {
  if (from === to) return false;
  const terminalStatuses = ["Completed", "Cancelled"];
  if (terminalStatuses.includes(from)) return false;
  const allowed = VALID_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidNextStatuses(currentStatus: string): string[] {
  if (["Completed", "Cancelled"].includes(currentStatus)) return [];
  return VALID_STATUS_TRANSITIONS[currentStatus] || [];
}

export function isValidDispatchTransition(from: string | null, to: string): boolean {
  if (from === to) return false;
  if (from === null) return to === "Pending Dispatch";
  const allowed = VALID_DISPATCH_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidNextDispatchStatuses(currentStatus: string | null): string[] {
  if (!currentStatus) return ["Pending Dispatch"];
  if (currentStatus === "Delivered") return [];
  return VALID_DISPATCH_TRANSITIONS[currentStatus] || [];
}

async function writeAuditTrail(
  exec: { insert: Function },
  params: {
    productionOrderId: number;
    action: string;
    oldValue?: string | null;
    newValue?: string | null;
    oldUnit?: string | null;
    newUnit?: string | null;
    oldQuantity?: string | null;
    newQuantity?: string | null;
    changedById: number;
    changedByName: string;
    reason?: string | null;
  }
) {
  await exec.insert(productionAuditTrailTable).values({
    productionOrderId: params.productionOrderId,
    action: params.action,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    oldUnit: params.oldUnit ?? null,
    newUnit: params.newUnit ?? null,
    oldQuantity: params.oldQuantity ?? null,
    newQuantity: params.newQuantity ?? null,
    changedById: params.changedById,
    changedByName: params.changedByName,
    reason: params.reason ?? null,
  });
}

export async function addTimelineEntry(
  exec: { insert: Function },
  productionOrderId: number,
  status: string,
  notes: string | null,
  userId: number
) {
  await exec.insert(productionTimelineTable).values({
    productionOrderId,
    status,
    notes,
    createdBy: userId,
  });
}

async function logProductionActivity(
  exec: { insert: Function },
  params: {
    dealId: number | null;
    contactId: number | null;
    eventName: string;
    orderId: number;
    invoiceNumber?: string;
    details?: string;
    userName: string;
    createdBy: number;
  }
) {
  const { dealId, contactId, eventName, orderId, invoiceNumber, details, userName, createdBy } = params;
  if (!dealId) return;

  const ts = formatTimestamp();
  const detailLines = details ? `\n\n${details}` : "";

  await logActivity(exec, {
    dealId,
    contactId,
    type: "Note",
    notes: `${eventName} — Order #${orderId}${invoiceNumber ? ` (${invoiceNumber})` : ""}${detailLines}\n\nBy: ${userName}\n${ts}`,
    createdBy,
  });
}

async function notifySalesOfProductionEvent(params: {
  productionOrderId: number;
  invoiceId: number | null;
  title: string;
  message: string;
  excludeUserId: number;
  createdByRole?: string | null;
}) {
  const { invoiceId, title, message, excludeUserId, productionOrderId, createdByRole } = params;
  if (!invoiceId) return;

  const [invoice] = await db
    .select({ createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
    .from(proformaInvoicesTable)
    .where(eq(proformaInvoicesTable.id, invoiceId));

  const userIds = new Set<number>();

  if (invoice?.createdBy && invoice.createdBy !== excludeUserId) {
    userIds.add(invoice.createdBy);
  }

  if (invoice?.contactId) {
    const [contact] = await db
      .select({ salesOwnerId: contactsTable.salesOwnerId })
      .from(contactsTable)
      .where(eq(contactsTable.id, invoice.contactId));
    if (contact?.salesOwnerId && contact.salesOwnerId !== excludeUserId) {
      userIds.add(contact.salesOwnerId);
    }
  }

  if (createdByRole === "production_and_support") {
    const supportUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "production_and_support"));
    for (const su of supportUsers) {
      if (su.id !== excludeUserId) userIds.add(su.id);
    }
  }

  for (const uid of userIds) {
    await db.insert(notificationsTable).values({
      userId: uid,
      type: "production_status",
      title,
      message,
      link: `/production/orders/${productionOrderId}`,
      relatedId: productionOrderId,
      relatedType: "production_order",
    });
  }
}

async function notifySupportOfReadyForDispatch(params: {
  productionOrderId: number;
  invoiceId: number | null;
  title: string;
  message: string;
  excludeUserId: number;
}) {
  const { productionOrderId, title, message, excludeUserId } = params;

  const supportUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(or(eq(usersTable.role, "production_and_support"), eq(usersTable.role, "admin")));

  for (const su of supportUsers) {
    if (su.id !== excludeUserId) {
      await db.insert(notificationsTable).values({
        userId: su.id,
        type: "production_status",
        title,
        message,
        link: `/production/orders/${productionOrderId}`,
        relatedId: productionOrderId,
        relatedType: "production_order",
      });
    }
  }
}

// ═══════════════════════════════════════════════════
// PRODUCT LINE PRODUCTION STATUS FUNCTIONS
// ═══════════════════════════════════════════════════

export async function syncProductionOrderItems(productionOrderId: number, invoiceId: number | null): Promise<void> {
  if (!invoiceId) return;

  const existing = await db.select({ id: productionOrderItemsTable.id })
    .from(productionOrderItemsTable)
    .where(eq(productionOrderItemsTable.productionOrderId, productionOrderId))
    .limit(1);
  if (existing.length > 0) return;

  const invoiceItems = await db.select().from(proformaInvoiceItemsTable)
    .where(eq(proformaInvoiceItemsTable.invoiceId, invoiceId));

  if (invoiceItems.length === 0) return;

  for (const item of invoiceItems) {
    const product = await resolveProductForPiItem(item);
    await db.insert(productionOrderItemsTable).values({
      productionOrderId,
      piItemId: item.id,
      productName: item.productName,
      materialType: product?.materialType || null,
      machineType: product?.machineType || null,
      bottleColour: item.bottleColour || product?.bottleColour || null,
      bottleWeight: product?.bottleWeight || null,
      capColour: product?.capColour || null,
      hsnCode: item.hsnCode || null,
      orderedQuantity: String(item.quantity),
      readyQuantity: "0",
      productionStatus: "Pending",
    });
  }
}

async function resolveProductForPiItem(piItem: typeof proformaInvoiceItemsTable.$inferSelect): Promise<typeof productsTable.$inferSelect | undefined> {
  if (piItem.productId) {
    const [found] = await db.select().from(productsTable).where(eq(productsTable.id, piItem.productId)).limit(1);
    if (found) return found;
  }
  const [found] = await db.select().from(productsTable)
    .where(eq(productsTable.name, piItem.productName!)).limit(1);
  return found;
}

export async function resyncProductionOrderItems(
  productionOrderId: number,
  invoiceId: number | null,
  txDb?: typeof db
): Promise<{ added: number; updated: number; deleted: number }> {
  const d = txDb || db;
  if (!invoiceId) return { added: 0, updated: 0, deleted: 0 };

  const piItems = await d.select().from(proformaInvoiceItemsTable)
    .where(eq(proformaInvoiceItemsTable.invoiceId, invoiceId));
  if (piItems.length === 0) return { added: 0, updated: 0, deleted: 0 };

  const existingItems = await d.select().from(productionOrderItemsTable)
    .where(eq(productionOrderItemsTable.productionOrderId, productionOrderId));

  const matchedIds = new Set<number>();
  let added = 0;
  let updated = 0;

  for (const piItem of piItems) {
    const byPiItemId = existingItems.find(e => e.piItemId === piItem.id && !matchedIds.has(e.id));
    const byName = !byPiItemId ? existingItems.find(e =>
      e.productName?.toLowerCase()?.trim() === piItem.productName?.toLowerCase()?.trim() && !matchedIds.has(e.id)
    ) : null;
    const existing = byPiItemId || byName;

    const product = await resolveProductForPiItem(piItem);

    if (existing) {
      matchedIds.add(existing.id);
      await d.update(productionOrderItemsTable).set({
        productName: piItem.productName,
        materialType: product?.materialType || null,
        machineType: product?.machineType || null,
        bottleColour: piItem.bottleColour || product?.bottleColour || null,
        bottleWeight: product?.bottleWeight || null,
        capColour: product?.capColour || null,
        hsnCode: piItem.hsnCode || null,
        orderedQuantity: String(piItem.quantity),
        piItemId: piItem.id,
        updatedAt: new Date(),
      }).where(eq(productionOrderItemsTable.id, existing.id));
      updated++;
    } else {
      await d.insert(productionOrderItemsTable).values({
        productionOrderId,
        piItemId: piItem.id,
        productName: piItem.productName,
        materialType: product?.materialType || null,
        machineType: product?.machineType || null,
        bottleColour: piItem.bottleColour || product?.bottleColour || null,
        bottleWeight: product?.bottleWeight || null,
        capColour: product?.capColour || null,
        hsnCode: piItem.hsnCode || null,
        orderedQuantity: String(piItem.quantity),
        readyQuantity: "0",
        productionStatus: "Pending",
      });
      added++;
    }
  }

  let deleted = 0;
  for (const item of existingItems) {
    if (!matchedIds.has(item.id) && item.productionStatus === "Pending") {
      await d.delete(productionOrderItemsTable).where(eq(productionOrderItemsTable.id, item.id));
      deleted++;
    }
  }

  return { added, updated, deleted };
}

export function computeOverallOrderStatus(items: { productionStatus: string }[]): string {
  if (items.length === 0) return "Pending";
  const statuses = items.map(i => i.productionStatus);
  const allPending = statuses.every(s => s === "Pending");
  if (allPending) return "Pending";
  const allReady = statuses.every(s => s === "Ready");
  if (allReady) return "Ready To Dispatch";
  return "Production On Going";
}

export async function recalculateOrderStatus(orderId: number, triggeredBy?: { id: number; name: string }): Promise<void> {
  const items = await db.select({ productionStatus: productionOrderItemsTable.productionStatus })
    .from(productionOrderItemsTable)
    .where(eq(productionOrderItemsTable.productionOrderId, orderId));
  if (items.length === 0) return;

  const newStatus = computeOverallOrderStatus(items);
  const [order] = await db.select().from(productionOrdersTable)
    .where(eq(productionOrdersTable.id, orderId));
  if (!order) return;

  // No change needed
  if (order.status === newStatus) return;

  const validTransitions: Record<string, string[]> = {
    "Pending": ["Production On Going", "Ready To Dispatch"],
    "Production On Going": ["Ready To Dispatch", "Packaging"],
    "Packaging": ["Ready To Dispatch", "Production On Going"],
  };

  const allowed = validTransitions[order.status];
  if (!allowed || !allowed.includes(newStatus)) return;

  const now = new Date();
  const updateData: any = { updatedAt: now, updatedBy: triggeredBy?.id || null };
  const oldStatus = order.status;

  if (newStatus === "Ready To Dispatch") {
    updateData.status = "Ready To Dispatch";
    updateData.dispatchStatus = "Pending Dispatch";
    updateData.isFrozen = true;
    updateData.readyAt = now;
  } else if (newStatus === "Production On Going") {
    updateData.status = "Production On Going";
    updateData.startedById = order.startedById || triggeredBy?.id || null;
    updateData.startedAt = order.startedAt || now;
    updateData.isFrozen = true;
  }

  if (updateData.status) {
    await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));
  }

  // ── Timeline ──
  const actorName = triggeredBy?.name || "System";
  await addTimelineEntry(db, orderId, newStatus,
    `Auto: ${oldStatus} → ${newStatus}\nAll product lines updated.\nBy: ${actorName}`,
    triggeredBy?.id || 0);

  // ── Audit Trail ──
  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "auto_status_change",
    oldValue: oldStatus, newValue: newStatus,
    changedById: triggeredBy?.id || 0, changedByName: actorName,
    reason: "All product lines updated — automatic transition",
  });

  // ── Invoice lookup for notifications ──
  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];
  const invoiceNum = invoice?.invoiceNumber || orderId;

  // ── Status-specific side effects ──
  if (newStatus === "Ready To Dispatch") {
    await notifySupportOfReadyForDispatch({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Ready To Dispatch",
      message: `Order #${invoiceNum} — all products ready. Dispatch action required.`,
      excludeUserId: triggeredBy?.id || 0,
    });

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Ready To Dispatch",
      message: `Order #${invoiceNum} is ready for dispatch. All product lines complete.`,
      excludeUserId: triggeredBy?.id || 0, createdByRole: order.createdByRole,
    });
  }

  if (newStatus === "Production On Going") {
    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Production Started",
      message: `Order #${invoiceNum} production started.`,
      excludeUserId: triggeredBy?.id || 0, createdByRole: order.createdByRole,
    });
  }

  // ── Activity Log ──
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null,
    eventName: `Auto Status: ${oldStatus} → ${newStatus}`,
    orderId, details: `All product lines updated. Automatic transition.`,
    userName: actorName, createdBy: triggeredBy?.id || 0,
  });
}

export async function updateProductLineStatus(
  user: PermissionUser,
  orderId: number,
  itemId: number,
  data: { productionStatus: string; readyQuantity?: number }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const [item] = await db.select().from(productionOrderItemsTable).where(eq(productionOrderItemsTable.id, itemId));
  if (!item) return { error: "Product line not found", status: 404 };
  if (item.productionOrderId !== orderId) return { error: "Item does not belong to this order", status: 400 };

  const newStatus = data.productionStatus as ProductLineStatus;
  if (!PRODUCT_LINE_STATUSES.includes(newStatus)) {
    return { error: `Invalid status: ${newStatus}. Valid: ${PRODUCT_LINE_STATUSES.join(", ")}`, status: 400 };
  }
  if (item.productionStatus === newStatus && data.readyQuantity === undefined) {
    return { error: "No change", status: 400 };
  }

  const now = new Date();
  const orderedQty = Number(item.orderedQuantity);
  let readyQty = data.readyQuantity !== undefined ? data.readyQuantity : Number(item.readyQuantity);

  if (readyQty < 0) readyQty = 0;
  if (readyQty > orderedQty) readyQty = orderedQty;

  const updateData: any = { productionStatus: newStatus, readyQuantity: String(readyQty), updatedAt: now };

  if (newStatus === "In Production" && !item.startedAt) {
    updateData.startedAt = now;
  }
  if (newStatus === "Ready") {
    readyQty = orderedQty;
    updateData.readyQuantity = String(orderedQty);
    updateData.completedAt = now;
  }

  const remaining = orderedQty - readyQty;
  if (readyQty > 0 && readyQty < orderedQty && newStatus !== "Ready") {
    updateData.productionStatus = "In Production";
  }
  if (remaining <= 0 && newStatus !== "Ready") {
    updateData.productionStatus = "Ready";
    updateData.readyQuantity = String(orderedQty);
    updateData.completedAt = now;
  }

  await db.update(productionOrderItemsTable).set(updateData).where(eq(productionOrderItemsTable.id, itemId));

  const oldStatus = item.productionStatus;
  const statusChanged = oldStatus !== updateData.productionStatus;
  if (statusChanged) {
    await addTimelineEntry(db, orderId, updateData.productionStatus,
      `${item.productName}: ${oldStatus} → ${updateData.productionStatus}\nReady: ${updateData.readyQuantity} / ${orderedQty} PCS\nBy: ${user.name}`,
      user.id);

    await writeAuditTrail(db, {
      productionOrderId: orderId,
      action: "product_status_change",
      oldValue: `${item.productName}: ${oldStatus}`,
      newValue: `${item.productName}: ${updateData.productionStatus} (${updateData.readyQuantity}/${orderedQty})`,
      changedById: user.id, changedByName: user.name || "",
    });
  }

  if (updateData.productionStatus === "Ready" && oldStatus !== "Ready") {
    const [invoice] = order.proformaInvoiceId
      ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber })
          .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
      : [];

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Product Ready",
      message: `${item.productName} is Ready — Order #${invoice?.invoiceNumber || orderId} — Ready for Dispatch`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });

    const supportUsers = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(or(eq(usersTable.role, "production_and_support"), eq(usersTable.role, "admin")));
    for (const su of supportUsers) {
      if (su.id !== user.id) {
        await db.insert(notificationsTable).values({
          userId: su.id, type: "production_status",
          title: "Product Ready",
          message: `${item.productName} is Ready — Order #${orderId} — Ready for Dispatch`,
          link: `/production/orders/${orderId}`,
          relatedId: orderId, relatedType: "production_order",
        });
      }
    }
  }

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null,
    eventName: `Product Status: ${item.productName} → ${updateData.productionStatus}`,
    orderId, details: `Ready: ${updateData.readyQuantity} / ${orderedQty} PCS`,
    userName: user.name || "", createdBy: user.id,
  });

  await recalculateOrderStatus(orderId, { id: user.id, name: user.name || "Unknown" });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function getProductLineItems(orderId: number) {
  const items = await db.select().from(productionOrderItemsTable)
    .where(eq(productionOrderItemsTable.productionOrderId, orderId));
  return items.map(i => ({
    ...i,
    orderedQuantity: Number(i.orderedQuantity),
    readyQuantity: Number(i.readyQuantity),
    remainingQuantity: Number(i.orderedQuantity) - Number(i.readyQuantity),
    progressPercent: Number(i.orderedQuantity) > 0
      ? Math.round((Number(i.readyQuantity) / Number(i.orderedQuantity)) * 100)
      : 0,
  }));
}

export async function notifyProductionUsersOfProductReady(params: {
  productionOrderId: number;
  productName: string;
  excludeUserId: number;
}) {
  const { productionOrderId, productName, excludeUserId } = params;
  const supportUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(or(eq(usersTable.role, "production_and_support"), eq(usersTable.role, "admin")));
  for (const su of supportUsers) {
    if (su.id !== excludeUserId) {
      await db.insert(notificationsTable).values({
        userId: su.id, type: "production_status",
        title: "Product Ready",
        message: `${productName} is Ready — Order #${productionOrderId}`,
        link: `/production/orders/${productionOrderId}`,
        relatedId: productionOrderId, relatedType: "production_order",
      });
    }
  }
}

export async function enrichProductionOrder(order: any, user?: { role: string }) {
  let invoice: any = null;
  if (order.proformaInvoiceId) {
    const [inv] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
    invoice = inv || null;
  }
  if (!invoice && order.dealId) {
    const [inv] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.dealId, order.dealId), eq(proformaInvoicesTable.isActive, true), eq(proformaInvoicesTable.isDeleted, false)))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(1);
    invoice = inv || null;
  }
  if (!invoice && order.dealId) {
    const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, order.dealId));
    if (deal?.contactId) {
      const [inv] = await db
        .select()
        .from(proformaInvoicesTable)
        .where(and(eq(proformaInvoicesTable.contactId, deal.contactId), eq(proformaInvoicesTable.isActive, true), eq(proformaInvoicesTable.isDeleted, false)))
        .orderBy(desc(proformaInvoicesTable.createdAt))
        .limit(1);
      invoice = inv || null;
    }
  }

  const items = invoice
    ? await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, invoice.id))
    : [];

  const allProducts = await db.select().from(productsTable);
  const productMap = new Map(allProducts.map(p => [p.name?.toLowerCase()?.trim(), p]));

  const enrichedItems = items.map((i: any) => {
    const product = productMap.get(i.productName?.toLowerCase()?.trim());
    return {
      ...i,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      amount: Number(i.amount),
      gstPercent: Number(i.gstPercent || 0),
      materialType: product?.materialType || null,
      machineType: product?.machineType || null,
      bottleColour: i.bottleColour || product?.bottleColour || null,
      bottleWeight: product?.bottleWeight || null,
      capColour: product?.capColour || null,
      productCode: product?.productCode || null,
    };
  });

  let contact = null;
  if (invoice?.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, invoice.contactId));
    if (c) contact = c;
  }
  if (!contact && order.dealId) {
    const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, order.dealId));
    if (deal?.contactId) {
      const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (c) contact = c;
    }
  }

  let assignedManager = null;
  if (order.assignedProductionManagerId) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name, colorCode: usersTable.colorCode })
      .from(usersTable).where(eq(usersTable.id, order.assignedProductionManagerId));
    if (u) assignedManager = u;
  }

  let lastUpdatedBy = null;
  if (order.updatedBy) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.updatedBy));
    if (u) lastUpdatedBy = u;
  }

  let acceptedBy = null;
  if (order.acceptedById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.acceptedById));
    if (u) acceptedBy = u;
  }

  let startedBy = null;
  if (order.startedById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.startedById));
    if (u) startedBy = u;
  }

  let cancelledBy = null;
  if (order.cancelledById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.cancelledById));
    if (u) cancelledBy = u;
  }

  let packingCompletedBy = null;
  if (order.packingCompletedById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.packingCompletedById));
    if (u) packingCompletedBy = u;
  }

  let transportBookedBy = null;
  if (order.transportBookedById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.transportBookedById));
    if (u) transportBookedBy = u;
  }

  let dispatchedBy = null;
  if (order.dispatchedById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.dispatchedById));
    if (u) dispatchedBy = u;
  }

  let deliveredBy = null;
  if (order.deliveredById) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.deliveredById));
    if (u) deliveredBy = u;
  }

  const timeline = await db
    .select()
    .from(productionTimelineTable)
    .where(eq(productionTimelineTable.productionOrderId, order.id))
    .orderBy(desc(productionTimelineTable.createdAt));

  const timelineWithUsers = await Promise.all(
    timeline.map(async (t) => {
      let user = null;
      if (t.createdBy) {
        const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, t.createdBy));
        if (u) user = u;
      }
      return { ...t, createdByUser: user };
    })
  );

  const notes = await db
    .select()
    .from(productionNotesTable)
    .where(eq(productionNotesTable.productionOrderId, order.id))
    .orderBy(desc(productionNotesTable.createdAt));

  const notesWithUsers = await Promise.all(
    notes.map(async (n) => {
      let user = null;
      if (n.createdBy) {
        const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, n.createdBy));
        if (u) user = u;
      }
      return { ...n, createdByUser: user };
    })
  );

  let productLineItems = await db.select().from(productionOrderItemsTable)
    .where(eq(productionOrderItemsTable.productionOrderId, order.id));

  // Auto-sync items from PI if empty (backward compat for pre-existing orders)
  if (productLineItems.length === 0 && order.proformaInvoiceId) {
    await syncProductionOrderItems(order.id, order.proformaInvoiceId);
    productLineItems = await db.select().from(productionOrderItemsTable)
      .where(eq(productionOrderItemsTable.productionOrderId, order.id));
  }

  const enrichedProductLineItems = productLineItems.map((i: any) => ({
    ...i,
    orderedQuantity: Number(i.orderedQuantity),
    readyQuantity: Number(i.readyQuantity),
    remainingQuantity: Number(i.orderedQuantity) - Number(i.readyQuantity),
    progressPercent: Number(i.orderedQuantity) > 0
      ? Math.round((Number(i.readyQuantity) / Number(i.orderedQuantity)) * 100)
      : 0,
  }));

  const result = {
    ...order,
    invoice: invoice
      ? {
          ...invoice,
          taxableAmount: Number(invoice.taxableAmount || 0),
          freight: Number(invoice.freight || 0),
          cgst: Number(invoice.cgst || 0),
          sgst: Number(invoice.sgst || 0),
          igst: Number(invoice.igst || 0),
          cgstPercent: Number(invoice.cgstPercent || 0),
          sgstPercent: Number(invoice.sgstPercent || 0),
          igstPercent: Number(invoice.igstPercent || 0),
          grandTotal: Number(invoice.grandTotal || 0),
        }
      : null,
    items: enrichedItems,
    productLineItems: enrichedProductLineItems,
    contact,
    assignedManager,
    lastUpdatedBy,
    acceptedBy,
    startedBy,
    cancelledBy,
    packingCompletedBy,
    transportBookedBy,
    dispatchedBy,
    deliveredBy,
    timeline: timelineWithUsers,
    notes: notesWithUsers,
    validNextStatuses: getValidNextStatuses(order.status),
    validNextDispatchStatuses: getValidNextDispatchStatuses(order.dispatchStatus),
    displayOrderId: order.formattedOrderId || (order.createdAt ? `EML_${getFinancialYear(new Date(order.createdAt))}_${order.id}` : `#${order.id}`),
    customerCode: contact?.customerCode || null,
    companyName: contact?.companyName || contact?.name || invoice?.companyName || null,
    customerName: contact?.name || invoice?.customerName || null,
    orderNumber: order.formattedOrderId || (order.createdAt ? `EML_${getFinancialYear(new Date(order.createdAt))}_${order.id}` : `#${order.id}`),
  };
  // Mask customer identity for production-only users
  if (user && isProductionOnlyRole(user.role)) {
    result.contact = maskContactForProduction(result.contact);
    result.invoice = maskInvoiceForProduction(result.invoice, result.contact?.customerCode || null);
  }

  return result;
}

export async function acceptOrder(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Production On Going")) {
    return { error: `Cannot accept order in "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Production On Going",
    acceptedById: user.id,
    acceptedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Production On Going", `Status: ${order.status} → Production On Going\nOrder accepted by ${user.name}`, user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Order Accepted",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Production On Going",
    changedById: user.id, changedByName: user.name || "",
  });

  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, createdBy: proformaInvoicesTable.createdBy })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Production Order Accepted",
    message: `Order #${invoice?.invoiceNumber || orderId} has been accepted by ${user.name}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function updatePlanning(
  user: PermissionUser,
  orderId: number,
  data: { machine?: string; expectedStartDate?: string; expectedCompletionDate?: string; expectedDispatchDate?: string; priority?: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const editableStatuses = ["Pending", "Production On Going", "Packaging"];
  if (!editableStatuses.includes(order.status)) {
    return { error: `Cannot update planning for order in "${order.status}" status.`, status: 400 };
  }

  const now = new Date();
  const updateData: any = { updatedBy: user.id, updatedAt: now };

  if (data.machine !== undefined) updateData.plannedMachine = data.machine;
  if (data.expectedStartDate !== undefined) updateData.expectedStartDate = data.expectedStartDate;
  if (data.expectedCompletionDate !== undefined) updateData.expectedCompletionDate = data.expectedCompletionDate;
  if (data.expectedDispatchDate !== undefined) updateData.expectedDispatchDate = data.expectedDispatchDate;
  if (data.priority !== undefined) updateData.priority = data.priority;

  if (order.status === "Pending") {
    updateData.status = "Production On Going";
  }

  await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));

  if (order.status === "Pending") {
    await addTimelineEntry(db, orderId, "Production On Going", `Status: Pending → Production On Going\nPlanning started by ${user.name}`, user.id);
  }

  if (data.notes) {
    await db.insert(productionNotesTable).values({
      productionOrderId: orderId, note: data.notes, noteType: "planning", createdBy: user.id,
    });
  }

  if (data.expectedStartDate !== undefined && data.expectedStartDate !== order.expectedStartDate) {
    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Expected Date Changed",
      message: `Order #${orderId}: Expected start date changed to ${data.expectedStartDate}`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });
  }
  if (data.expectedCompletionDate !== undefined && data.expectedCompletionDate !== order.expectedCompletionDate) {
    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Expected Date Changed",
      message: `Order #${orderId}: Expected completion date changed to ${data.expectedCompletionDate}`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });
  }

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "planning_update",
    oldValue: order.plannedMachine || null, newValue: data.machine || null,
    changedById: user.id, changedByName: user.name || "",
  });

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Planning Updated",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  // Notify Sales that planning was created
  if (order.status === "Pending") {
    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Planning Created",
      message: `Order #${orderId}: Production planning has been created with expected dates.`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function startProduction(
  user: PermissionUser,
  orderId: number,
  data?: { machine?: string; operatorName?: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Production On Going")) {
    return { error: `Cannot start production from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  const updateData: any = {
    status: "Production On Going",
    startedById: user.id,
    startedAt: now,
    isFrozen: true,
    updatedBy: user.id,
    updatedAt: now,
  };

  if (data?.machine) updateData.productionMachine = data.machine;
  if (data?.operatorName) updateData.operatorName = data.operatorName;
  if (data?.notes) updateData.inProductionNotes = data.notes;

  await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));

  const timelineNotes = [`Status: ${order.status} → Production On Going\nProduction started by ${user.name}. Machine frozen.`];
  if (data?.machine) timelineNotes.push(`Machine: ${data.machine}`);
  if (data?.operatorName) timelineNotes.push(`Operator: ${data.operatorName}`);

  await addTimelineEntry(db, orderId, "Production On Going", timelineNotes.join("\n"), user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Started",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Production On Going",
    changedById: user.id, changedByName: user.name || "",
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Production Started",
    message: `Order #${order.id} has entered Production On Going stage.${data?.machine ? ` Machine: ${data.machine}` : ""}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function completePacking(
  user: PermissionUser,
  orderId: number,
  data: { packingType: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Packaging")) {
    return { error: `Cannot pack from "${order.status}" status`, status: 400 };
  }
  if (!["Bundle", "Packet"].includes(data.packingType)) {
    return { error: "Packing type must be 'Bundle' or 'Packet'", status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Packaging",
    packingType: data.packingType,
    packingNotes: data.notes || null,
    packingCompletedById: user.id,
    packingCompletedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  const timelineText = [
    `Status: ${order.status} → Packaging\nPacking started by ${user.name}`,
    `Packing type: ${data.packingType}`,
  ];
  if (data.notes) timelineText.push(`Notes: ${data.notes}`);

  await addTimelineEntry(db, orderId, "Packaging", timelineText.join("\n"), user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Packing Started",
    orderId, details: `Type: ${data.packingType}${data.notes ? `\nNotes: ${data.notes}` : ""}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Packaging",
    changedById: user.id, changedByName: user.name || "",
    reason: `Packing type: ${data.packingType}`,
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Packing Started",
    message: `Order #${order.id} is now in Packaging. Type: ${data.packingType}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function markReadyForDispatch(
  user: PermissionUser,
  orderId: number,
  notes?: string
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Ready To Dispatch")) {
    return { error: `Cannot mark ready from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Ready To Dispatch",
    dispatchStatus: "Pending Dispatch",
    isFrozen: true,
    readyAt: now,
    updatedBy: user.id,
    updatedAt: now,
  } as any).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Ready To Dispatch",
    `Status: ${order.status} → Ready To Dispatch\nReady for dispatch. Marked by ${user.name}${notes ? `\n${notes}` : ""}`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Ready To Dispatch",
    orderId, details: notes || undefined, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Ready To Dispatch",
    changedById: user.id, changedByName: user.name || "", reason: notes,
  });

  // Notify Support that order is ready for dispatch
  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  await notifySupportOfReadyForDispatch({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready To Dispatch",
    message: `Order #${invoice?.invoiceNumber || orderId} is ready for dispatch. Support action required.`,
    excludeUserId: user.id,
  });

  // Also notify Sales
  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready To Dispatch",
    message: `Order #${invoice?.invoiceNumber || orderId} is ready for dispatch. Support team has been notified.`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function bookTransport(
  user: PermissionUser,
  orderId: number,
  data: { transportCompany: string; bookingNumber: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (order.status !== "Ready To Dispatch") {
    return { error: "Order must be in 'Ready To Dispatch' status to book transport", status: 400 };
  }
  if (user.role !== "admin" && user.role !== "production_and_support") {
    return { error: "Only support or admin users can book transport", status: 403 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    transportName: data.transportCompany,
    transportDetails: data.bookingNumber,
    transportBookedById: user.id,
    transportBookedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, order.status,
    `Transport booked by ${user.name}\nCompany: ${data.transportCompany}\nBooking: ${data.bookingNumber}`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Transport Booked",
    orderId,
    details: `Company: ${data.transportCompany}\nBooking: ${data.bookingNumber}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "transport_booked",
    oldValue: null, newValue: `${data.transportCompany} / ${data.bookingNumber}`,
    changedById: user.id, changedByName: user.name || "",
  });

  // Notify Sales + Production that transport is booked
  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Transport Booked",
    message: `Order #${invoice?.invoiceNumber || orderId} is in transit. Transport: ${data.transportCompany}, Booking: ${data.bookingNumber}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function completeOrder(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Completed")) {
    return { error: `Cannot complete order from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Completed",
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Completed", `Order completed by ${user.name}`, user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Order Completed",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Completed",
    changedById: user.id, changedByName: user.name || "",
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Order Completed",
    message: `Order #${orderId} has been completed.`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

// ═══════════════════════════════════════════════════
// DISPATCH WORKFLOW FUNCTIONS (Support team only)
// ═══════════════════════════════════════════════════

async function requireSupportOrAdmin(user: PermissionUser): Promise<string | null> {
  if (user.role === "admin" || user.role === "production_and_support") return null;
  return "Only support or admin users can perform dispatch actions";
}

async function requireDispatchReadAccess(user: PermissionUser): Promise<string | null> {
  if (user.role === "admin" || user.role === "production_and_support" || user.role === "production") return null;
  return "Only production, support, or admin users can view dispatch data";
}

export async function loadVehicle(
  user: PermissionUser,
  orderId: number,
  data: { transportName: string; lrNumber?: string; builtyUrl?: string; dispatchRemarks?: string }
): Promise<any> {
  const supportError = await requireSupportOrAdmin(user);
  if (supportError) return { error: supportError, status: 403, code: "FORBIDDEN" };

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404, code: "NOT_FOUND" };

  if (order.status !== "Ready To Dispatch") {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: `Order must be 'Ready To Dispatch' before loading vehicle`,
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }

  // Auto-initialize null dispatchStatus to "Pending Dispatch" for legacy orders
  if (!order.dispatchStatus) {
    await db.update(productionOrdersTable).set({
      dispatchStatus: "Pending Dispatch",
      updatedBy: user.id,
      updatedAt: new Date(),
    }).where(eq(productionOrdersTable.id, orderId));
    order.dispatchStatus = "Pending Dispatch";
  }

  if (!isValidDispatchTransition(order.dispatchStatus, "Load Vehicle")) {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: `Cannot load vehicle from "${order.dispatchStatus}" dispatch status`,
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }

  const now = new Date();
  const updateData: any = {
    dispatchStatus: "Load Vehicle",
    transportName: data.transportName,
    lrNumber: data.lrNumber || null,
    dispatchRemarks: data.dispatchRemarks || null,
    transportBookedById: user.id,
    transportBookedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  };
  if (data.builtyUrl) updateData.builtyUrl = data.builtyUrl;

  await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));

  const timelineText = [
    `Dispatch: Load Vehicle`,
    `Transport: ${data.transportName}`,
    `LR/Builty: ${data.lrNumber || "N/A"}`,
  ];
  if (data.dispatchRemarks) timelineText.push(`Remarks: ${data.dispatchRemarks}`);

  await addTimelineEntry(db, orderId, "Load Vehicle", timelineText.join("\n"), user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Dispatch — Load Vehicle",
    orderId, details: `Transport: ${data.transportName}\nLR: ${data.lrNumber || "N/A"}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "dispatch_load_vehicle",
    oldValue: order.dispatchStatus, newValue: "Load Vehicle",
    changedById: user.id, changedByName: user.name || "",
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Dispatch — Load Vehicle",
    message: `Order #${orderId}: Vehicle loaded. Transport: ${data.transportName}, LR: ${data.lrNumber || "N/A"}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function markDispatched(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const supportError = await requireSupportOrAdmin(user);
  if (supportError) return { error: supportError, status: 403, code: "FORBIDDEN" };

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404, code: "NOT_FOUND" };
  if (order.status !== "Ready To Dispatch") {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: "Order must be 'Ready To Dispatch' to dispatch",
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }
  if (!isValidDispatchTransition(order.dispatchStatus, "Dispatch")) {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: `Cannot dispatch from "${order.dispatchStatus || "null"}" dispatch status`,
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    dispatchStatus: "Dispatch",
    dispatchedById: user.id,
    dispatchedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  const dispatchDate = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const dispatchTime = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  await addTimelineEntry(db, orderId, "Dispatch",
    `Dispatch: Dispatch\nDispatched on ${dispatchDate} at ${dispatchTime} by ${user.name}\nTransport: ${order.transportName || "N/A"}\nLR: ${order.lrNumber || "N/A"}`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Order Dispatched",
    orderId, details: `Dispatched on ${dispatchDate} at ${dispatchTime}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "dispatched",
    oldValue: order.dispatchStatus, newValue: "Dispatch",
    changedById: user.id, changedByName: user.name || "",
  });

  // Cleanup voice notes — order is now dispatched, voice notes no longer needed
  try {
    const { cleanupVoiceNotesForOrder } = await import("./voice-notes-service");
    const { deletedCount } = await cleanupVoiceNotesForOrder(orderId, "Order dispatched");
    if (deletedCount > 0) {
      await addTimelineEntry(db, orderId, "Dispatch",
        `Voice Note Cleanup: ${deletedCount} voice note(s) removed — order dispatched.`, user.id);
      await writeAuditTrail(db, {
        productionOrderId: orderId, action: "voice_note_cleanup",
        oldValue: `${deletedCount} notes`, newValue: "Deleted (dispatched)",
        changedById: user.id, changedByName: user.name || "",
      });
    }
  } catch (_) { /* voice note cleanup is best-effort */ }

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Order Dispatched",
    message: `Order #${orderId} has been dispatched. Transport: ${order.transportName || "N/A"}, LR: ${order.lrNumber || "N/A"}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function markDelivered(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const supportError = await requireSupportOrAdmin(user);
  if (supportError) return { error: supportError, status: 403, code: "FORBIDDEN" };

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404, code: "NOT_FOUND" };
  if (order.status !== "Ready To Dispatch") {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: "Order must be 'Ready To Dispatch' to mark delivered",
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }
  if (!isValidDispatchTransition(order.dispatchStatus, "Delivered")) {
    return {
      success: false, code: "INVALID_WORKFLOW",
      message: `Cannot mark delivered from "${order.dispatchStatus || "null"}" dispatch status`,
      currentProductionStatus: order.status, currentDispatchStatus: order.dispatchStatus,
      status: 400,
    };
  }

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  await db.update(productionOrdersTable).set({
    status: "Completed",
    dispatchStatus: "Delivered",
    deliveryDate: todayStr,
    deliveredById: user.id,
    deliveredAt: now,
    dispatchCompletedAt: now,
    dispatchCompletedBy: user.id,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Delivered",
    `Order Delivered\nCompleted on ${todayStr} by ${user.name}`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Order Delivered",
    orderId, details: `Delivered on ${todayStr}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "delivered",
    oldValue: order.dispatchStatus, newValue: "Delivered",
    changedById: user.id, changedByName: user.name || "",
  });

  // Cleanup voice notes — order is delivered, voice notes no longer needed
  try {
    const { cleanupVoiceNotesForOrder } = await import("./voice-notes-service");
    const { deletedCount } = await cleanupVoiceNotesForOrder(orderId, "Order delivered");
    if (deletedCount > 0) {
      await addTimelineEntry(db, orderId, "Delivered",
        `Voice Note Cleanup: ${deletedCount} voice note(s) removed — order delivered.`, user.id);
      await writeAuditTrail(db, {
        productionOrderId: orderId, action: "voice_note_cleanup",
        oldValue: `${deletedCount} notes`, newValue: "Deleted (delivered)",
        changedById: user.id, changedByName: user.name || "",
      });
    }
  } catch (_) { /* voice note cleanup is best-effort */ }

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Order Delivered",
    message: `Order #${orderId} has been delivered. Order is now complete.`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function getDispatchDashboard(user: PermissionUser, unitFilter?: string) {
  const supportError = await requireDispatchReadAccess(user);
  if (supportError) return { error: supportError, status: 403 };

  const conditions: SQL[] = [eq(productionOrdersTable.status, "Ready To Dispatch")];
  if (unitFilter && unitFilter !== "All") {
    conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
  }

  const allOrders = await db.select().from(productionOrdersTable)
    .where(and(...conditions));

  // Get distinct transport names for the filter dropdown
  const transportRows = await db.select({ transportName: productionOrdersTable.transportName })
    .from(productionOrdersTable)
    .where(and(...conditions, sql`${productionOrdersTable.transportName} IS NOT NULL`))
    .groupBy(productionOrdersTable.transportName);

  return {
    pendingDispatch: allOrders.filter(o => o.dispatchStatus === "Pending Dispatch" || o.dispatchStatus === null).length,
    loadVehicle: allOrders.filter(o => o.dispatchStatus === "Load Vehicle").length,
    dispatched: allOrders.filter(o => o.dispatchStatus === "Dispatch").length,
    delivered: allOrders.filter(o => o.dispatchStatus === "Delivered").length,
    total: allOrders.length,
    transports: transportRows.map(r => r.transportName).filter(Boolean).sort(),
  };
}

export async function listDispatchOrders(
  user: PermissionUser,
  filters: {
    status?: string;
    search?: string;
    page?: string;
    limit?: string;
    unit?: string;
    priority?: string;
    transport?: string;
    dispatchDateFrom?: string;
    dispatchDateTo?: string;
  }
) {
  const supportError = await requireDispatchReadAccess(user);
  if (supportError) return { error: supportError, status: 403 };

  const conditions: SQL[] = [eq(productionOrdersTable.status, "Ready To Dispatch")];

  // Dispatch status filter
  if (filters.status && filters.status !== "all") {
    if (filters.status === "Pending Dispatch") {
      conditions.push(or(
        eq(productionOrdersTable.dispatchStatus, "Pending Dispatch"),
        sql`${productionOrdersTable.dispatchStatus} IS NULL`
      )!);
    } else {
      conditions.push(eq(productionOrdersTable.dispatchStatus, filters.status));
    }
  }

  // Unit filter
  if (filters.unit && filters.unit !== "All") {
    conditions.push(eq(productionOrdersTable.productionUnit, filters.unit));
  }

  // Priority filter
  if (filters.priority && filters.priority !== "all") {
    conditions.push(eq(productionOrdersTable.priority, filters.priority));
  }

  // Transport filter (search by transport name on production_orders)
  if (filters.transport && filters.transport !== "all") {
    if (filters.transport === "none") {
      conditions.push(sql`${productionOrdersTable.transportName} IS NULL`);
    } else {
      conditions.push(sql`LOWER(${productionOrdersTable.transportName}) LIKE ${`%${filters.transport.toLowerCase()}%`}`);
    }
  }

  // Dispatch date range filter (on dispatchedAt timestamp)
  if (filters.dispatchDateFrom) {
    conditions.push(sql`${productionOrdersTable.dispatchedAt} >= ${filters.dispatchDateFrom}`);
  }
  if (filters.dispatchDateTo) {
    conditions.push(sql`${productionOrdersTable.dispatchedAt} <= ${filters.dispatchDateTo}::timestamp + INTERVAL '1 day'`);
  }

  // Multi-field search: customer code, order number, product name, transport, LR number, invoice number
  if (filters.search) {
    const q = filters.search.trim();
    const matchingOrders: SQL[] = [];

    // Search by order ID (exact match on production order)
    const orderIdMatch = parseInt(q, 10);
    if (!isNaN(orderIdMatch)) {
      matchingOrders.push(eq(productionOrdersTable.id, orderIdMatch));
    }

    // Search by customerCode from contacts table (via invoice → contactId)
    const matchingContacts = await db.select({ id: contactsTable.id }).from(contactsTable).where(
      sql`LOWER(${contactsTable.customerCode}) LIKE ${`%${q.toLowerCase()}%`}`
    );
    if (matchingContacts.length > 0) {
      const matchingInvoicesByContact = await db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable)
        .where(inArray(proformaInvoicesTable.contactId, matchingContacts.map(c => c.id)));
      if (matchingInvoicesByContact.length > 0) {
        matchingOrders.push(inArray(productionOrdersTable.proformaInvoiceId, matchingInvoicesByContact.map(i => i.id)));
      }
    }

    // Search by invoice number
    const matchingInvoicesByNumber = await db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable).where(
      sql`LOWER(${proformaInvoicesTable.invoiceNumber}) LIKE ${`%${q.toLowerCase()}%`}`
    );
    if (matchingInvoicesByNumber.length > 0) {
      matchingOrders.push(inArray(productionOrdersTable.proformaInvoiceId, matchingInvoicesByNumber.map(i => i.id)));
    }

    // Search by product name (via production_order_items)
    const matchingProductItems = await db.select({ productionOrderId: productionOrderItemsTable.productionOrderId })
      .from(productionOrderItemsTable)
      .where(sql`LOWER(${productionOrderItemsTable.productName}) LIKE ${`%${q.toLowerCase()}%`}`)
      .groupBy(productionOrderItemsTable.productionOrderId);
    if (matchingProductItems.length > 0) {
      matchingOrders.push(inArray(productionOrdersTable.id, matchingProductItems.map(i => i.productionOrderId)));
    }

    // Search by transport name or LR number (direct on production_orders)
    matchingOrders.push(or(
      sql`LOWER(${productionOrdersTable.transportName}) LIKE ${`%${q.toLowerCase()}%`}`,
      sql`LOWER(${productionOrdersTable.lrNumber}) LIKE ${`%${q.toLowerCase()}%`}`
    )!);

    if (matchingOrders.length === 0) return { data: [], total: 0, page: 1, totalPages: 0, summary: null };
    conditions.push(or(...matchingOrders)!);
  }

  const pageNum = Math.max(1, parseInt(filters.page || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(filters.limit || "20", 10) || 20));
  const offset = (pageNum - 1) * pageSize;

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(productionOrdersTable)
    .where(and(...conditions));

  const orders = await db.select().from(productionOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(productionOrdersTable.updatedAt))
    .limit(pageSize).offset(offset);

  const enriched = await Promise.all(orders.map(o => enrichProductionOrder(o, user)));

  // Build summary for the full filtered set (not just the current page)
  const allFiltered = await db.select().from(productionOrdersTable).where(and(...conditions));
  const summary = {
    pendingDispatch: allFiltered.filter(o => o.dispatchStatus === "Pending Dispatch" || o.dispatchStatus === null).length,
    loadVehicle: allFiltered.filter(o => o.dispatchStatus === "Load Vehicle").length,
    dispatched: allFiltered.filter(o => o.dispatchStatus === "Dispatch").length,
    delivered: allFiltered.filter(o => o.dispatchStatus === "Delivered").length,
  };

  return { data: enriched, total: count, page: pageNum, totalPages: Math.ceil(count / pageSize), summary };
}

export async function handlePiModification(
  user: PermissionUser,
  productionOrderId: number,
  newPiVersion: number,
  txDb?: typeof db
): Promise<any> {
  const d = txDb || db;
  const [order] = await d.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, productionOrderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const preProductionStatuses = ["Pending", "Accepted", "Planning"];
  const inProductionStatuses = ["In Production", "Packing"];

  if (preProductionStatuses.includes(order.status)) {
    const syncResult = await resyncProductionOrderItems(productionOrderId, order.proformaInvoiceId, txDb);

    await d.update(productionOrdersTable).set({
      piVersionAtCreation: newPiVersion, updatedAt: new Date(), updatedBy: user.id,
      needsReprint: order.productionSheetVersion > 0,
    }).where(eq(productionOrdersTable.id, productionOrderId));

    const syncMsg = `PI updated to Version ${newPiVersion}. Auto-synced (${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.deleted} removed).`;
    await addTimelineEntry(d, productionOrderId, order.status, syncMsg, user.id);
    await logProductionActivity(d, {
      dealId: order.dealId, contactId: null, eventName: `PI Modified — Auto-synced (${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.deleted} removed)`,
      orderId: productionOrderId, userName: user.name || "", createdBy: user.id,
    });
    return { action: "auto_synced", order: await enrichProductionOrder(order, user) };
  }

  if (inProductionStatuses.includes(order.status)) {
    await d.update(productionOrdersTable).set({
      piVersionAtCreation: newPiVersion, updatedAt: new Date(), updatedBy: user.id,
      needsReprint: true,
    }).where(eq(productionOrdersTable.id, productionOrderId));
    await addTimelineEntry(d, productionOrderId, order.status, `PI modified to Version ${newPiVersion}. Awaiting production approval.`, user.id);
    await logProductionActivity(d, {
      dealId: order.dealId, contactId: null, eventName: `PI Modified — Approval Required (Version ${newPiVersion})`,
      orderId: productionOrderId, userName: user.name || "", createdBy: user.id,
    });

    await notifyProductionUsers({
      productionUnit: order.productionUnit || "Himatnagar",
      title: "PI Modified — Approval Required",
      message: `Order #${order.id}: PI has been modified by Sales. Version ${newPiVersion}. Review and accept/reject.`,
      link: `/production/orders/${order.id}`,
      relatedId: order.id, relatedType: "production_order",
      type: "production_pi_modified", excludeUserId: user.id,
    });

    return { action: "approval_required", order: await enrichProductionOrder(order, user) };
  }

  if (order.status === "Completed" || order.status === "In Transport") {
    const label = order.status === "Completed" ? "production completion" : "in-transport stage";
    await addTimelineEntry(d, productionOrderId, order.status, `PI modified after ${label}. No auto-sync.`, user.id);
    return { action: "rejected", message: `Production already ${label}. Suggest creating a new deal.` };
  }

  if (order.status === "Ready For Dispatch") {
    await d.update(productionOrdersTable).set({
      needsReprint: true,
      updatedAt: new Date(),
      updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, productionOrderId));
    await addTimelineEntry(d, productionOrderId, order.status, `PI modified to Version ${newPiVersion}. Dispatch stage — review required.`, user.id);
    await notifyProductionUsers({
      productionUnit: order.productionUnit || "Himatnagar",
      title: "PI Modified — Dispatch Review",
      message: `Order #${order.id}: PI has been modified by Sales at dispatch stage. Version ${newPiVersion}. Review changes.`,
      link: `/production/orders/${order.id}`,
      relatedId: order.id, relatedType: "production_order",
      type: "production_pi_modified", excludeUserId: user.id,
    });
    return { action: "dispatch_review", order: await enrichProductionOrder(order, user) };
  }

  return { action: "no_action" };
}

export async function approveModification(
  user: PermissionUser,
  orderId: number,
  approve: boolean
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const now = new Date();

  if (approve) {
    await addTimelineEntry(db, orderId, order.status, `Production approved PI modification.`, user.id);

    // Find the PI to sync from — by dealId's active PI, or fallback to current proformaInvoiceId
    let pi: any = null;
    if (order.dealId) {
      pi = await getActivePiForDeal(db, order.dealId);
    }
    if (!pi && order.proformaInvoiceId) {
      const [piRow] = await db.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
      pi = piRow;
    }

    if (pi) {
      // Wrap order update + items sync in a transaction
      await db.transaction(async (tx) => {
        await tx.update(productionOrdersTable).set({
          proformaInvoiceId: pi.id,
          piVersionAtCreation: pi.version,
          updatedAt: now,
          updatedBy: user.id,
        }).where(eq(productionOrdersTable.id, orderId));

        const syncResult = await resyncProductionOrderItems(orderId, pi.id, tx as unknown as typeof db);

        await writeAuditTrail(tx, {
          productionOrderId: orderId, action: "pi_modification_approved",
          changedById: user.id, changedByName: user.name || "",
          reason: `PI Version ${pi.version} approved — production order synced (${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.deleted} removed)`,
        });
      });
    }

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Modification Approved",
      message: `Order #${orderId}: Production has accepted the PI modification.`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });

    await logProductionActivity(db, {
      dealId: order.dealId, contactId: null, eventName: "PI Modification Approved",
      orderId, userName: user.name || "", createdBy: user.id,
    });
  } else {
    await addTimelineEntry(db, orderId, order.status, `Production rejected PI modification.`, user.id);
    await writeAuditTrail(db, {
      productionOrderId: orderId, action: "pi_modification_rejected",
      changedById: user.id, changedByName: user.name || "",
    });

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Modification Rejected",
      message: `Order #${orderId}: Production rejected the PI modification. Please review.`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });

    await logProductionActivity(db, {
      dealId: order.dealId, contactId: null, eventName: "PI Modification Rejected",
      orderId, userName: user.name || "", createdBy: user.id,
    });
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function updateOrderStatus(
  user: PermissionUser,
  orderId: number,
  data: { status: string; remarks?: string; voiceNoteId?: number; expectedCompletionDate?: string; productionRemarks?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  // Ready To Dispatch orders cannot be modified by production users
  if (order.status === "Ready To Dispatch" && user.role !== "admin") {
    return { error: "Order is ready for dispatch. Only admin can modify production status.", status: 403 };
  }

  const newStatus = data.status;
  const validStatuses = ["Pending", "Production On Going", "Packaging", "Ready To Dispatch", "Completed", "Cancelled"];
  if (!validStatuses.includes(newStatus)) {
    return { error: `Invalid status: ${newStatus}. Valid: ${validStatuses.join(", ")}`, status: 400 };
  }

  if (order.status === newStatus) {
    return { error: `Order is already in "${newStatus}" status`, status: 400 };
  }

  if (!isValidTransition(order.status, newStatus)) {
    return { error: `Cannot change status from "${order.status}" to "${newStatus}"`, status: 400 };
  }

  const now = new Date();
  const updateData: any = { status: newStatus, updatedBy: user.id, updatedAt: now };

  if (data.expectedCompletionDate !== undefined) {
    updateData.expectedCompletionDate = data.expectedCompletionDate || null;
  }
  if (data.productionRemarks !== undefined) {
    updateData.productionRemarks = data.productionRemarks || null;
  }

  if (newStatus === "Production On Going") {
    updateData.startedById = updateData.startedById || user.id;
    updateData.startedAt = updateData.startedAt || now;
  }

  if (newStatus === "Ready To Dispatch") {
    updateData.dispatchStatus = "Pending Dispatch";
    updateData.isFrozen = true;
    updateData.readyAt = now;
  }

  if (newStatus === "Cancelled") {
    if (!data.remarks?.trim()) {
      return { error: "Cancellation reason is required", status: 400 };
    }
    updateData.cancelledById = user.id;
    updateData.cancelledAt = now;
    updateData.cancelReason = data.remarks;
  }

  await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));

  // Build detailed timeline notes
  const timelineParts = [`Status: ${order.status} → ${newStatus}`];
  if (data.remarks) timelineParts.push(`Remarks: ${data.remarks}`);
  if (data.voiceNoteId) timelineParts.push(`Voice Note: [attached]`);
  timelineParts.push(`By: ${user.name}`);
  await addTimelineEntry(db, orderId, newStatus, timelineParts.join("\n"), user.id);

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: newStatus,
    changedById: user.id, changedByName: user.name || "",
    reason: data.remarks || null,
  });

  // Link voice note if provided
  if (data.voiceNoteId) {
    try {
      const { voiceNotesTable } = await import("@workspace/db");
      await db.update(voiceNotesTable).set({
        productionOrderId: orderId,
      }).where(eq(voiceNotesTable.id, data.voiceNoteId));
    } catch (_) { /* voice note linking is best-effort */ }
  }

  // Notify relevant parties based on new status
  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  const invoiceNum = invoice?.invoiceNumber || orderId;

  if (newStatus === "Ready To Dispatch") {
    await notifySupportOfReadyForDispatch({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Ready To Dispatch",
      message: `Order #${invoiceNum} is ready for dispatch. Support action required.`,
      excludeUserId: user.id,
    });
  }

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: `Status Changed: ${newStatus}`,
    message: `Order #${invoiceNum} status changed from "${order.status}" to "${newStatus}" by ${user.name}${data.remarks ? `. Remarks: ${data.remarks}` : ""}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null,
    eventName: `Status Changed: ${order.status} → ${newStatus}`,
    orderId, details: data.remarks || undefined,
    userName: user.name || "", createdBy: user.id,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function cancelOrder(
  user: PermissionUser,
  orderId: number,
  reason: string
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Cancelled")) {
    return { error: `Cannot cancel order in "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Cancelled", cancelledById: user.id, cancelledAt: now, cancelReason: reason,
    updatedBy: user.id, updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Cancelled", `Status: ${order.status} → Cancelled\nCancelled by ${user.name}. Reason: ${reason}`, user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Order Cancelled",
    orderId, details: `Reason: ${reason}`, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "cancelled",
    oldValue: order.status, newValue: "Cancelled",
    changedById: user.id, changedByName: user.name || "", reason,
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Production Order Cancelled",
    message: `Order #${orderId} has been cancelled. Reason: ${reason}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

export async function addNote(
  user: PermissionUser,
  orderId: number,
  note: string,
  noteType: NoteType = "general"
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const [newNote] = await db.insert(productionNotesTable).values({
    productionOrderId: orderId, note: note.trim(), noteType, createdBy: user.id,
  }).returning();

  if (order.dealId) {
    const ts = formatTimestamp();
    await logActivity(db, {
      dealId: order.dealId, contactId: null, type: "Note",
      notes: `Production Note (${noteType})\n\n"${note.trim()}"\n\nBy: ${user.name}\n${ts}`,
      createdBy: user.id,
    });
  }

  let createdByUser = null;
  createdByUser = { id: user.id, name: user.name };

  return { note: { ...newNote, createdByUser } };
}

export async function checkDelayedOrders(): Promise<{ checked: number; markedDelayed: number }> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const activeOrders = await db
    .select()
    .from(productionOrdersTable)
    .where(and(
      inArray(productionOrdersTable.status, ["Production On Going", "Packaging"]),
      eq(productionOrdersTable.isDelayed, false),
      sql`${productionOrdersTable.expectedCompletionDate} IS NOT NULL`,
    ));

  let markedDelayed = 0;
  for (const order of activeOrders) {
    if (order.expectedCompletionDate && order.expectedCompletionDate < todayStr) {
      await db.update(productionOrdersTable).set({
        isDelayed: true, delayedAt: today, updatedAt: today,
      }).where(eq(productionOrdersTable.id, order.id));

      await addTimelineEntry(db, order.id, order.status, `Order automatically marked as Delayed. Expected completion was ${order.expectedCompletionDate}.`, 0);

      await notifySalesOfProductionEvent({
        productionOrderId: order.id, invoiceId: order.proformaInvoiceId,
        title: "Production Order Delayed",
        message: `Order #${order.id} has passed its expected completion date (${order.expectedCompletionDate}).`,
        excludeUserId: 0, createdByRole: order.createdByRole,
      });

      markedDelayed++;
    }
  }

  return { checked: activeOrders.length, markedDelayed };
}

export async function getMessages(orderId: number) {
  return db.select().from(productionMessagesTable)
    .where(eq(productionMessagesTable.productionOrderId, orderId))
    .orderBy(productionMessagesTable.createdAt);
}

export async function sendMessage(
  user: PermissionUser,
  orderId: number,
  message: string
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const [newMessage] = await db.insert(productionMessagesTable).values({
    productionOrderId: orderId,
    senderId: user.id,
    senderName: user.name || "",
    senderRole: user.role,
    message: message.trim(),
  }).returning();

  const notifyUserIds: number[] = [];

  if (order.assignedProductionManagerId && order.assignedProductionManagerId !== user.id) {
    notifyUserIds.push(order.assignedProductionManagerId);
  }

  if (user.role === "production") {
    // Production → notify order creator and invoice creator
    if (order.createdById && order.createdById !== user.id) notifyUserIds.push(order.createdById);
    if (order.proformaInvoiceId) {
      const [inv] = await db.select({ createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
      if (inv?.createdBy && inv.createdBy !== user.id && !notifyUserIds.includes(inv.createdBy)) notifyUserIds.push(inv.createdBy);
      // Also notify sales owner of the contact
      if (inv?.contactId) {
        const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, inv.contactId));
        if (contact?.salesOwnerId && contact.salesOwnerId !== user.id && !notifyUserIds.includes(contact.salesOwnerId)) {
          notifyUserIds.push(contact.salesOwnerId);
        }
      }
    }
  } else {
    // Sales/Support/Admin → notify all production managers + admins + sales owner
    const productionUsers = await db.select({ id: usersTable.id }).from(usersTable)
      .where(or(eq(usersTable.role, "production"), eq(usersTable.role, "admin")));
    for (const u of productionUsers) {
      if (u.id !== user.id && !notifyUserIds.includes(u.id)) notifyUserIds.push(u.id);
    }
  }

  // Use createNotification for SSE emission; use message ID as relatedId to avoid dedup suppression
  // Heading explicitly states the department the message came from; body holds the snippet.
  const senderDept =
    user.role === "production" ? "Production"
      : user.role === "production_and_support" ? "Support"
        : user.role === "sales" ? "Sales"
          : user.role === "admin" ? "Admin"
            : user.role || "Team";
  const chatTitle =
    senderDept === "Production" ? "Message from Production"
      : senderDept === "Support" ? "Support Chat"
        : `Message from ${senderDept}`;

  for (const uid of notifyUserIds) {
    await createNotification({
      userId: uid,
      type: "production_message",
      title: chatTitle,
      message: `${user.name}: ${message.trim().slice(0, 200)}`,
      link: `/production/orders/${orderId}`,
      relatedId: newMessage.id,
      relatedType: "production_message",
    });
  }

  return { message: newMessage };
}

export async function getDashboard(user: PermissionUser, unitFilter?: string, originFilter?: string, startDate?: string, endDate?: string) {
  const conditions: SQL[] = [];
  if (user.role !== "admin") {
    const u = (user as any).unit || "All";
    if (u !== "All") {
      conditions.push(or(
        eq(productionOrdersTable.productionUnit, u),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }
  }
  if (unitFilter && unitFilter !== "All" && unitFilter !== "all") {
    conditions.length = 0;
    conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
  }
  if (originFilter && originFilter !== "all") {
    conditions.push(eq(productionOrdersTable.createdByRole, originFilter));
  }
  if (startDate) conditions.push(gte(productionOrdersTable.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(productionOrdersTable.createdAt, new Date(endDate + "T23:59:59")));

  // Active (non-terminal) order statuses — excludes Completed / Cancelled / Delivered
  const activeStatuses = [
    "Pending", "Accepted", "Planning",
    "Production On Going", "In Production",
    "Packaging", "Packing",
    "Ready To Dispatch", "Ready For Dispatch", "In Transport",
  ];

  // Single query: fetch all active orders + their product line items in one pass,
  // joined with proforma_invoices to skip soft-deleted invoices.
  const allRows = await db
    .select({
      orderId: productionOrdersTable.id,
      orderStatus: productionOrdersTable.status,
      piIsDeleted: proformaInvoicesTable.isDeleted,
      orderIsDelayed: productionOrdersTable.isDelayed,
      lineId: productionOrderItemsTable.id,
      lineStatus: productionOrderItemsTable.productionStatus,
      orderedQty: productionOrderItemsTable.orderedQuantity,
      readyQty: productionOrderItemsTable.readyQuantity,
    })
    .from(productionOrdersTable)
    .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, productionOrdersTable.proformaInvoiceId))
    .leftJoin(productionOrderItemsTable, eq(productionOrderItemsTable.productionOrderId, productionOrdersTable.id))
    .where(and(...conditions, inArray(productionOrdersTable.status, activeStatuses)));

  // Group rows by order
  const orderMap = new Map<number, {
    status: string; piIsDeleted: boolean | null; isDelayed: boolean;
    items: { lineStatus: string; orderedQty: string; readyQty: string }[];
  }>();
  for (const row of allRows) {
    if (!orderMap.has(row.orderId)) {
      orderMap.set(row.orderId, {
        status: row.orderStatus,
        piIsDeleted: row.piIsDeleted,
        isDelayed: row.orderIsDelayed ?? false,
        items: [],
      });
    }
    if (row.lineId) {
      orderMap.get(row.orderId)!.items.push({
        lineStatus: row.lineStatus,
        orderedQty: row.orderedQty,
        readyQty: row.readyQty,
      });
    }
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let pendingPieces = 0;
  let inProductionPieces = 0;
  let readyPieces = 0;
  let dispatchPendingCount = 0;
  let delayedOrders = 0;
  let activeOrders = 0;

  for (const [, order] of orderMap) {
    // Exclude orders linked to soft-deleted proforma invoices
    if (order.piIsDeleted) continue;
    activeOrders++;
    if (order.isDelayed) delayedOrders++;

    const isRtd = order.status === "Ready To Dispatch" || order.status === "Ready For Dispatch";
    if (isRtd) dispatchPendingCount++;

    // In Transport — en route, not pending or in-production
    if (order.status === "In Transport") continue;

    if (order.items.length === 0) continue;

    for (const item of order.items) {
      const ordered = Number(item.orderedQty) || 0;
      const ready = Number(item.readyQty) || 0;
      const remaining = ordered - ready;

      if (isRtd) {
        // Ready To Dispatch orders: all item quantities are counted as ready
        readyPieces += ready;
        continue;
      }

      // Non-RTD active orders: separate Pending vs In Production counts
      if (remaining > 0) {
        const effectiveStatus = item.lineStatus || "Pending";
        if (effectiveStatus === "Pending") {
          pendingPieces += remaining;
        } else if (effectiveStatus === "In Production") {
          inProductionPieces += remaining;
        }
      }

      // Items fully marked ready contribute to ready count
      if (item.lineStatus === "Ready" && ready > 0) {
        readyPieces += ready;
      }
    }
  }

  // Completed today — query separately using exact timestamp
  const [{ completedTodayCount }] = await db
    .select({ completedTodayCount: sql<number>`count(*)::int` })
    .from(productionOrdersTable)
    .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, productionOrdersTable.proformaInvoiceId))
    .where(and(
      ...conditions,
      eq(productionOrdersTable.status, "Completed"),
      gte(productionOrdersTable.updatedAt, todayStart),
      or(sql`${proformaInvoicesTable.isDeleted} IS NULL`, eq(proformaInvoicesTable.isDeleted, false)),
    ));

  return {
    pendingCount: pendingPieces,
    productionOnGoingCount: inProductionPieces,
    packagingCount: 0,
    readyToDispatchCount: readyPieces,
    completedToday: completedTodayCount || 0,
    delayedOrders,
    activeOrders,
    totalOrders: activeOrders,
    dispatchPendingCount,
    productLineStats: {
      pendingPieces,
      inProductionPieces,
      readyPieces,
    },
  };
}

export function buildOrderConditions(
  user: PermissionUser,
  filters: {
    status?: string; unit?: string; dateFrom?: string; dateTo?: string;
    dispatchStatus?: string; priority?: string; origin?: string; createdBy?: string;
  }
): SQL[] {
  const conditions: SQL[] = [];

  if (user.role !== "admin") {
    const u = (user as any).unit || "All";
    if (u !== "All") {
      conditions.push(or(
        inArray(productionOrdersTable.productionUnit, [u]),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }
  }
  if (filters.unit && filters.unit !== "all" && filters.unit !== "All" && (user.role === "admin" || (user as any).unit === "All")) {
    conditions.push(eq(productionOrdersTable.productionUnit, filters.unit));
  }
  if (filters.status && filters.status !== "all") conditions.push(eq(productionOrdersTable.status, filters.status));
  if (filters.dispatchStatus && filters.dispatchStatus !== "all") {
    if (filters.dispatchStatus === "Pending Dispatch") {
      conditions.push(or(
        eq(productionOrdersTable.dispatchStatus, "Pending Dispatch"),
        sql`${productionOrdersTable.dispatchStatus} IS NULL`
      )!);
    } else {
      conditions.push(eq(productionOrdersTable.dispatchStatus, filters.dispatchStatus));
    }
  }
  if (filters.priority && filters.priority !== "all") conditions.push(eq(productionOrdersTable.priority, filters.priority));
  if (filters.origin && filters.origin !== "all") {
    conditions.push(eq(productionOrdersTable.createdByRole, filters.origin));
  }
  if (filters.createdBy && filters.createdBy !== "all") {
    if (filters.createdBy === "sales") conditions.push(eq(productionOrdersTable.createdByRole, "sales"));
    else if (filters.createdBy === "production_and_support") conditions.push(eq(productionOrdersTable.createdByRole, "production_and_support"));
    else { const uid = parseInt(filters.createdBy, 10); if (!isNaN(uid)) conditions.push(eq(productionOrdersTable.createdById, uid)); }
  }
  if (filters.dateFrom) conditions.push(gte(productionOrdersTable.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lte(productionOrdersTable.createdAt, new Date(filters.dateTo + "T23:59:59")));

  return conditions;
}

export async function getMachineReport(
  user: PermissionUser,
  filters: { unit?: string; machineType?: string; product?: string; status?: string; dateFrom?: string; dateTo?: string }
) {
  const conditions = buildOrderConditions(user, {
    status: filters.status,
    unit: filters.unit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  // Default: exclude completed/cancelled/delivered orders unless explicit status filter is set
  if (!filters.status || filters.status === "All") {
    conditions.push(
      notInArray(productionOrdersTable.status, ["Completed", "Delivered", "Cancelled"])
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orders = await db
    .select({
      id: productionOrdersTable.id,
      status: productionOrdersTable.status,
      productionUnit: productionOrdersTable.productionUnit,
      createdAt: productionOrdersTable.createdAt,
      proformaInvoiceId: productionOrdersTable.proformaInvoiceId,
      orderNumber: productionOrdersTable.formattedOrderId,
    })
    .from(productionOrdersTable)
    .where(whereClause);

  if (orders.length === 0) {
    return {
      summary: { totalProducts: 0, totalBottles: 0, pending: 0, inProduction: 0, completed: 0 },
      materialBreakdown: [],
      orders: [],
    };
  }

  const orderIds = orders.map(o => o.id);
  const productLines = await db.select().from(productionOrderItemsTable)
    .where(inArray(productionOrderItemsTable.productionOrderId, orderIds));

  const invoiceToOrder = new Map(orders.map(o => [o.proformaInvoiceId, o]));

  const productRows: {
    orderId: number; orderNumber: string | null; status: string; productionUnit: string | null; createdAt: Date | null;
    productName: string; machineType: string | null; materialType: string | null;
    bottleColour: string | null; bottleWeight: string | null; productCode: string | null;
    quantity: number; readyQuantity: number; productionStatus: string;
  }[] = [];

  for (const line of productLines) {
    const order = orders.find(o => o.id === line.productionOrderId);
    if (!order) continue;

    productRows.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      productionUnit: order.productionUnit,
      createdAt: order.createdAt,
      productName: line.productName,
      machineType: line.machineType || null,
      materialType: line.materialType || null,
      bottleColour: line.bottleColour || null,
      bottleWeight: line.bottleWeight || null,
      productCode: null,
      quantity: Number(line.orderedQuantity),
      readyQuantity: Number(line.readyQuantity),
      productionStatus: line.productionStatus,
    });
  }

  if (productRows.length === 0) {
    for (const item of await db.select().from(proformaInvoiceItemsTable)
      .where(inArray(proformaInvoiceItemsTable.invoiceId, orders.map(o => o.proformaInvoiceId).filter(Boolean) as number[]))) {
      const order = invoiceToOrder.get(item.invoiceId);
      if (!order) continue;
      productRows.push({
        orderId: order.id, orderNumber: order.orderNumber, status: order.status, productionUnit: order.productionUnit,
        createdAt: order.createdAt, productName: item.productName, machineType: null,
        materialType: null, bottleColour: item.bottleColour || null, bottleWeight: null, productCode: null,
        quantity: Number(item.quantity), readyQuantity: 0, productionStatus: order.status === "Completed" ? "Ready" : "Pending",
      });
    }
  }

  let filteredRows = productRows;
  if (filters.machineType && filters.machineType !== "All") {
    filteredRows = filteredRows.filter(r => r.machineType === filters.machineType);
  }
  if (filters.product && filters.product !== "All") {
    filteredRows = filteredRows.filter(r => r.productName === filters.product);
  }

  // Production statuses that require active machine work
  const PENDING_ST = ["Pending", "Pending Verification", "Confirmed", "Production Pending", "Accepted", "Planning"];
  const IN_PROD_ST = ["In Production", "Production On Going", "Production Started", "Production Running"];
  // Any status not in PENDING or IN_PROD is considered dormant (Ready, Completed, etc.) and excluded
  const DORMANT_ST = ["Ready", "Completed", "Ready For Dispatch", "In Transport", "Delivered", "Cancelled"];

  const statusBucket = (row: typeof filteredRows[0]): "pending" | "inProduction" | "dormant" => {
    const ps = row.productionStatus;
    if (PENDING_ST.includes(ps)) return "pending";
    if (IN_PROD_ST.includes(ps)) return "inProduction";
    if (DORMANT_ST.includes(ps)) return "dormant";
    const os = row.status;
    if (PENDING_ST.includes(os)) return "pending";
    if (IN_PROD_ST.includes(os)) return "inProduction";
    return "dormant";
  };

  // Also filter out items whose bucket is "dormant" — they should not appear on a live machine report
  filteredRows = filteredRows.filter(r => statusBucket(r) !== "dormant");

  let pendingCount = 0, inProductionCount = 0;

  const machineMap = new Map<string, {
    productCount: number; orderIds: Set<number>; totalBottles: number;
    pendingQty: number; inProductionQty: number;
  }>();
  for (const row of filteredRows) {
    const key = row.machineType || "Unassigned";
    const existing = machineMap.get(key) || { productCount: 0, orderIds: new Set<number>(), totalBottles: 0, pendingQty: 0, inProductionQty: 0 };
    existing.productCount++;
    existing.orderIds.add(row.orderId);
    existing.totalBottles += row.quantity - row.readyQuantity;
    const remaining = row.quantity - row.readyQuantity;
    const bucket = statusBucket(row);
    if (bucket === "pending") { pendingCount++; existing.pendingQty += remaining > 0 ? remaining : 0; }
    else if (bucket === "inProduction") { inProductionCount++; existing.inProductionQty += remaining > 0 ? remaining : 0; }
    machineMap.set(key, existing);
  }

  const summary = {
    totalProducts: filteredRows.length,
    totalBottles: filteredRows.reduce((s, r) => s + (r.quantity - r.readyQuantity), 0),
    pending: pendingCount,
    inProduction: inProductionCount,
    completed: 0,
  };

  const materialMachineMap = new Map<string, Map<string, {
    productCount: number; orderIds: Set<number>; totalBottles: number;
    pendingQty: number; inProductionQty: number;
  }>>();
  for (const row of filteredRows) {
    const material = row.materialType || "Unknown";
    const machine = row.machineType || "Unassigned";
    if (!materialMachineMap.has(material)) materialMachineMap.set(material, new Map());
    const innerMap = materialMachineMap.get(material)!;
    const existing = innerMap.get(machine) || { productCount: 0, orderIds: new Set<number>(), totalBottles: 0, pendingQty: 0, inProductionQty: 0 };
    existing.productCount++;
    existing.orderIds.add(row.orderId);
    existing.totalBottles += row.quantity - row.readyQuantity;
    const remaining = row.quantity - row.readyQuantity;
    const bucket = statusBucket(row);
    if (bucket === "pending") existing.pendingQty += remaining > 0 ? remaining : 0;
    else if (bucket === "inProduction") existing.inProductionQty += remaining > 0 ? remaining : 0;
    innerMap.set(machine, existing);
  }

  const materialOrder = ["HDPE", "PET", "PP", "Unknown"];
  const materialBreakdown = [...materialMachineMap.entries()]
    .sort(([a], [b]) => {
      const ai = materialOrder.indexOf(a);
      const bi = materialOrder.indexOf(b);
      const aRank = ai >= 0 ? ai : materialOrder.length;
      const bRank = bi >= 0 ? bi : materialOrder.length;
      return aRank - bRank;
    })
    .map(([materialType, machines]) => ({
      materialType,
      machines: [...machines.entries()].map(([machineType, data]) => ({
        machineType,
        productCount: data.productCount,
        orderCount: data.orderIds.size,
        totalBottles: data.totalBottles,
        pendingQty: data.pendingQty,
        inProductionQty: data.inProductionQty,
      })),
    }));

  return { summary, materialBreakdown, orders: filteredRows };
}

export async function listOrders(
  user: PermissionUser,
  filters: {
    status?: string; dispatchStatus?: string; priority?: string; search?: string;
    dateFrom?: string; dateTo?: string; createdBy?: string;
    unit?: string; origin?: string; page?: string; limit?: string;
  }
) {
  const conditions = buildOrderConditions(user, filters);

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const matchingInvoices = await db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable).where(
      or(
        sql`LOWER(${proformaInvoicesTable.customerName}) LIKE ${`%${searchLower}%`}`,
        sql`LOWER(${proformaInvoicesTable.companyName}) LIKE ${`%${searchLower}%`}`,
        sql`${proformaInvoicesTable.invoiceNumber} ILIKE ${`%${filters.search}%`}`,
        sql`${proformaInvoicesTable.mobile} ILIKE ${`%${filters.search}%`}`
      )
    );
    if (matchingInvoices.length === 0) return { data: [], total: 0, page: 1, totalPages: 0 };
    conditions.push(sql`${productionOrdersTable.proformaInvoiceId} IN (${sql.join(matchingInvoices.map(i => sql`${i.id}`), sql`, `)})`);
  }

  const pageNum = Math.max(1, parseInt(filters.page || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(filters.limit || "15", 10) || 15));
  const offset = (pageNum - 1) * pageSize;

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const orders = await db.select().from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrdersTable.createdAt))
    .limit(pageSize).offset(offset);

  const enriched = await Promise.all(orders.map(o => enrichProductionOrder(o, user)));

  return { data: enriched, total: count, page: pageNum, totalPages: Math.ceil(count / pageSize) };
}

export async function getOrderDetail(user: PermissionUser, orderId: number) {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  if (user.role !== "admin" && order.productionUnit) {
    const u = (user as any).unit || "All";
    if (u !== "All" && u !== order.productionUnit) {
      return { error: "Forbidden: production unit not accessible", status: 403 };
    }
  }

  return { order: await enrichProductionOrder(order, user) };
}

export async function getAuditTrail(orderId: number) {
  const trail = await db.execute(sql`
    SELECT pat.*, u.name as "changedByName"
    FROM production_audit_trail pat
    LEFT JOIN users u ON u.id = pat.changed_by_id
    WHERE pat.production_order_id = ${orderId}
    ORDER BY pat.created_at DESC
  `);
  return trail.rows || [];
}

export async function getPendingSummary(user: PermissionUser, unitFilter?: string) {
  const effectiveUnit = ((user as any).unit !== "All" && user.role !== "admin")
    ? (user as any).unit
    : (unitFilter && unitFilter !== "All" && unitFilter !== "all" ? unitFilter : undefined);

  const unitCondition = effectiveUnit && effectiveUnit !== "all"
    ? sql`AND po.production_unit = ${effectiveUnit}`
    : sql``;

  // Source of truth: production_order_items (the dynamic line-items table holding
  // ordered_quantity, ready_quantity, and remaining values).
  // Pending = SUM(ordered - ready) across all non-terminal orders that are NOT
  // yet fully ready (exclude RTD / In Transport / Completed / Cancelled).
  // Only count items with production_status = 'Pending' — In Production items
  // are NOT pending; they are actively being manufactured.
  // Exclude soft-deleted invoices and items whose remaining has reached zero.
  // Use COALESCE to treat NULL statuses as 'Pending' and TRIM to handle whitespace.
  const results = await db.execute(sql`
    SELECT
      oi.product_name AS "productName",
      COALESCE(NULLIF(oi.bottle_colour, ''), 'N/A') AS "bottleColour",
      COALESCE(NULLIF(oi.bottle_weight, ''), '-') AS "bottleWeight",
      COALESCE(NULLIF(oi.cap_colour, ''), 'N/A') AS "capColour",
      COALESCE(NULLIF(oi.cap_weight, ''), '-') AS "capWeight",
      COALESCE(NULLIF(oi.material_type, ''), 'N/A') AS "materialType",
      SUM(oi.ordered_quantity::numeric - oi.ready_quantity::numeric) AS "totalPendingQuantity",
      COUNT(DISTINCT oi.production_order_id) AS "orderCount",
      array_agg(DISTINCT oi.production_order_id) AS "orderIds"
    FROM production_order_items oi
    JOIN production_orders po ON po.id = oi.production_order_id
    LEFT JOIN proforma_invoices pi ON pi.id = po.proforma_invoice_id
    WHERE po.status NOT IN ('Completed', 'Cancelled', 'Ready To Dispatch', 'Ready For Dispatch', 'In Transport')
      AND (pi.id IS NULL OR pi.is_deleted = false)
      AND COALESCE(oi.production_status, 'Pending') = 'Pending'
      AND (oi.ordered_quantity::numeric - oi.ready_quantity::numeric) > 0
      ${unitCondition}
    GROUP BY oi.product_name, oi.bottle_colour, oi.bottle_weight, oi.cap_colour, oi.cap_weight, oi.material_type
    HAVING SUM(oi.ordered_quantity::numeric - oi.ready_quantity::numeric) > 0
    ORDER BY SUM(oi.ordered_quantity::numeric - oi.ready_quantity::numeric) DESC
  `);

  const summary = (results.rows || []).map((r: any) => ({
    productName: r.productName,
    bottleColour: r.bottleColour,
    bottleWeight: r.bottleWeight,
    capColour: r.capColour,
    capWeight: r.capWeight,
    materialType: r.materialType,
    totalPendingQuantity: Number(r.totalPendingQuantity),
    orderCount: Number(r.orderCount),
    orderIds: r.orderIds,
  }));

  return {
    products: summary,
    totalPendingProducts: summary.length,
    totalPendingPieces: summary.reduce((s: number, r: any) => s + r.totalPendingQuantity, 0),
  };
}

export async function getPendingRequirements(user: PermissionUser, unitFilter?: string) {
  const conditions: SQL[] = [];
  if (unitFilter && unitFilter !== "All" && unitFilter !== "all") {
    conditions.push(sql`o.production_unit = ${unitFilter}`);
  } else if (user.role !== "admin") {
    const u = (user as any).unit || "All";
    if (u !== "All") {
      conditions.push(sql`o.production_unit = ${u}`);
    }
  }

  const results = await db.execute(sql`
    SELECT
      oi.product_name AS "productName",
      COALESCE(gramage, 'N/A') AS "gramage",
      SUM(oi.quantity::numeric) AS "totalOrdered",
      SUM(oi.dispatched_quantity::numeric) AS "totalDispatched",
      SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric) AS "pending",
      COUNT(DISTINCT oi.order_id) AS "orderCount"
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.is_deleted = false
      AND oi.status NOT IN ('Completed', 'Cancelled', 'Dispatched')
      AND o.status NOT IN ('Cancelled', 'Completed')
      AND (
        NOT EXISTS (
          SELECT 1 FROM production_orders po WHERE po.deal_id = o.deal_id
        )
        OR EXISTS (
          SELECT 1 FROM production_orders po
          WHERE po.deal_id = o.deal_id
            AND po.status NOT IN ('Completed', 'Cancelled')
        )
      )
      ${conditions.length > 0 ? sql`AND ${conditions[0]}` : sql``}
    GROUP BY oi.product_name, gramage
    HAVING SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric) > 0
    ORDER BY (SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric)) DESC
  `);

  return results.rows || [];
}

export async function getReports(user: PermissionUser, filters: { unit?: string; status?: string; dateFrom?: string; dateTo?: string; origin?: string }) {
  const conditions: SQL[] = [];
  if (user.role !== "admin") {
    const u = (user as any).unit || "All";
    if (u !== "All") {
      conditions.push(or(
        eq(productionOrdersTable.productionUnit, u),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }
  }
  if (filters.unit && filters.unit !== "all") conditions.push(eq(productionOrdersTable.productionUnit, filters.unit));
  if (filters.status && filters.status !== "all") conditions.push(eq(productionOrdersTable.status, filters.status));
  if (filters.dateFrom) conditions.push(gte(productionOrdersTable.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lte(productionOrdersTable.createdAt, new Date(filters.dateTo + "T23:59:59")));
  if (filters.origin && filters.origin !== "all") conditions.push(eq(productionOrdersTable.createdByRole, filters.origin));

  const allOrders = await db.select().from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrdersTable.createdAt));

  const enriched = await Promise.all(allOrders.map(o => enrichProductionOrder(o, user)));

  const byStatus: Record<string, number> = {};
  const byUnit: Record<string, number> = {};
  for (const o of enriched) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    byUnit[o.productionUnit || "Unassigned"] = (byUnit[o.productionUnit || "Unassigned"] || 0) + 1;
  }

  return { data: enriched, stats: { totalOrders: enriched.length, byStatus, byUnit } };
}

export async function getProgressByDeal(user: PermissionUser, dealId: number) {
  const [invoice] = await db.select().from(proformaInvoicesTable)
    .where(eq(proformaInvoicesTable.dealId, dealId))
    .orderBy(desc(proformaInvoicesTable.createdAt)).limit(1);
  if (!invoice) return null;

  const [po] = await db.select().from(productionOrdersTable)
    .where(eq(productionOrdersTable.proformaInvoiceId, invoice.id));
  if (!po) return null;

  if (user.role !== "admin" && po.productionUnit) {
    const u = (user as any).unit || "All";
    if (u !== "All" && u !== po.productionUnit) return { error: "Forbidden", status: 403 };
  }

  const timeline = await db.select({
    id: productionTimelineTable.id, status: productionTimelineTable.status,
    notes: productionTimelineTable.notes, createdAt: productionTimelineTable.createdAt,
    createdByName: usersTable.name,
  }).from(productionTimelineTable)
    .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
    .where(eq(productionTimelineTable.productionOrderId, po.id))
    .orderBy(desc(productionTimelineTable.createdAt));

  const notes = await db.select({
    id: productionNotesTable.id, note: productionNotesTable.note, noteType: productionNotesTable.noteType,
    createdAt: productionNotesTable.createdAt, createdByName: usersTable.name,
  }).from(productionNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, productionNotesTable.createdBy))
    .where(eq(productionNotesTable.productionOrderId, po.id))
    .orderBy(desc(productionNotesTable.createdAt));

  let assignedManager = null;
  if (po.assignedProductionManagerId) {
    const [m] = await db.select().from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
    if (m) { const { passwordHash: _, ...safe } = m; assignedManager = safe; }
  }

  let lastUpdatedBy = null;
  if (po.updatedBy) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
    if (u) lastUpdatedBy = u;
  }

  return {
    id: po.id, status: po.status, priority: po.priority,
    expectedDispatchDate: po.expectedDispatchDate, assignedProductionManager: assignedManager,
    productionUnit: po.productionUnit, productionRemarks: po.productionRemarks,
    updatedAt: po.updatedAt, lastUpdatedBy, timeline, notes,
    invoiceNumber: invoice.invoiceNumber,
    plannedMachine: po.plannedMachine, productionMachine: po.productionMachine,
    operatorName: po.operatorName, inProductionNotes: po.inProductionNotes,
    packingType: po.packingType, packingNotes: po.packingNotes,
    expectedStartDate: po.expectedStartDate,
    expectedCompletionDate: po.expectedCompletionDate, isFrozen: po.isFrozen,
    isDelayed: po.isDelayed, startedAt: po.startedAt, acceptedAt: po.acceptedAt,
    transportName: po.transportName, transportDetails: po.transportDetails,
    packingCompletedAt: po.packingCompletedAt,
    transportBookedAt: po.transportBookedAt,
    dispatchStatus: po.dispatchStatus, lrNumber: po.lrNumber, dispatchRemarks: po.dispatchRemarks,
    productLineItems: (await db.select().from(productionOrderItemsTable)
      .where(eq(productionOrderItemsTable.productionOrderId, po.id))).map(i => ({
      ...i,
      orderedQuantity: Number(i.orderedQuantity),
      readyQuantity: Number(i.readyQuantity),
      remainingQuantity: Number(i.orderedQuantity) - Number(i.readyQuantity),
      progressPercent: Number(i.orderedQuantity) > 0
        ? Math.round((Number(i.readyQuantity) / Number(i.orderedQuantity)) * 100)
        : 0,
    })),
  };
}

export async function getProductionByContact(user: PermissionUser, contactId: number) {
  const invoices = await db.select().from(proformaInvoicesTable)
    .where(eq(proformaInvoicesTable.contactId, contactId))
    .orderBy(desc(proformaInvoicesTable.createdAt));
  if (invoices.length === 0) return null;

  const invoiceIds = invoices.map(i => i.id);
  const orders = await db.select().from(productionOrdersTable)
    .where(inArray(productionOrdersTable.proformaInvoiceId, invoiceIds))
    .orderBy(desc(productionOrdersTable.createdAt));
  if (orders.length === 0) return null;

  if (user.role !== "admin") {
    const u = (user as any).unit || "All";
    if (u !== "All") {
      const filtered = orders.filter(o => !o.productionUnit || o.productionUnit === u);
      if (filtered.length === 0) return null;
      return buildContactResponse(filtered[0], invoices[0]);
    }
  }

  return buildContactResponse(orders[0], invoices[0]);
}

async function buildContactResponse(po: any, invoice: any) {
  let lastUpdatedBy = null;
  if (po.updatedBy) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
    if (u) lastUpdatedBy = u;
  }
  let assignedManager = null;
  if (po.assignedProductionManagerId) {
    const [m] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
    if (m) assignedManager = m;
  }

  const timeline = await db.select({
    id: productionTimelineTable.id, status: productionTimelineTable.status,
    notes: productionTimelineTable.notes, createdAt: productionTimelineTable.createdAt,
    createdByName: usersTable.name,
  }).from(productionTimelineTable)
    .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
    .where(eq(productionTimelineTable.productionOrderId, po.id))
    .orderBy(desc(productionTimelineTable.createdAt));

  return {
    id: po.id, status: po.status, priority: po.priority,
    expectedDispatchDate: po.expectedDispatchDate, productionUnit: po.productionUnit,
    productionRemarks: po.productionRemarks, updatedAt: po.updatedAt, createdAt: po.createdAt,
    lastUpdatedBy, assignedManager, createdByName: po.createdByName, createdByRole: po.createdByRole,
    timeline, invoiceId: invoice?.id, invoiceNumber: invoice?.invoiceNumber,
    isFrozen: po.isFrozen, isDelayed: po.isDelayed,
    plannedMachine: po.plannedMachine, productionMachine: po.productionMachine,
    expectedStartDate: po.expectedStartDate, expectedCompletionDate: po.expectedCompletionDate,
    packingType: po.packingType, transportName: po.transportName, transportDetails: po.transportDetails,
  };
}

export async function getModifiedSince(user: PermissionUser, since?: string) {
  const sinceDate = since ? new Date(since) : new Date(0);
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(productionOrdersTable)
    .where(and(
      gte(productionOrdersTable.updatedAt, sinceDate),
      eq(productionOrdersTable.status, "Pending"),
    ));
  return { count: Number(count) || 0 };
}

export async function getManufacturingSummary(user: PermissionUser, unitFilter?: string, originFilter?: string, materialFilter?: string) {
  const effectiveUnit = ((user as any).unit !== "All" && user.role !== "admin")
    ? (user as any).unit
    : (unitFilter && unitFilter !== "All" && unitFilter !== "all" ? unitFilter : undefined);

  const materialCondition = materialFilter && materialFilter !== "All" && materialFilter !== "all"
    ? sql`AND lower(COALESCE(p.material_type, '')) = lower(${materialFilter})`
    : sql``;

  const results = await db.execute(sql`
    WITH active_orders AS (
      SELECT po.id AS po_id, po.status, po.production_unit, po.created_by_role,
             po.proforma_invoice_id AS resolved_invoice_id
      FROM production_orders po
      LEFT JOIN proforma_invoices pi ON pi.id = po.proforma_invoice_id
      WHERE po.status NOT IN ('Completed', 'Cancelled', 'Ready To Dispatch', 'Ready For Dispatch', 'In Transport')
        AND po.proforma_invoice_id IS NOT NULL
        AND (pi.id IS NULL OR pi.is_deleted = false)
        ${effectiveUnit && effectiveUnit !== "all" ? sql`AND po.production_unit = ${effectiveUnit}` : sql``}
        ${originFilter && originFilter !== "all" ? sql`AND po.created_by_role = ${originFilter}` : sql``}
    ),
    product_lines AS (
      SELECT
        poi.production_order_id AS po_id,
        poi.product_name,
        poi.production_status,
        poi.ordered_quantity,
        poi.ready_quantity,
        COALESCE(NULLIF(pii.weight, ''), '-') AS weight,
        COALESCE(NULLIF(p.bottle_colour, ''), 'N/A') AS colour,
        COALESCE(NULLIF(p.bottle_colour_code, ''), '') AS colour_code,
        COALESCE(NULLIF(p.material_type, 'HDPE'), 'HDPE') AS material_type,
        TRIM(LOWER(COALESCE(NULLIF(pii.weight, ''), '-'))) AS weight_norm,
        TRIM(LOWER(COALESCE(NULLIF(p.bottle_colour, ''), 'N/A'))) AS colour_norm,
        INITCAP(TRIM(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                LOWER(poi.product_name),
                '\\s*\\d+(\\.\\d+)?\\s*(ml|l|gm|g|kg|ltr|litre|liter|cm|mm)\\s*$', '', 'i'
              ),
              '\\s*(blue|red|green|white|yellow|black|orange|pink|grey|gray|transparent|natural|brown|purple|navy|maroon|beige|cream|silver|golden|off\\s*white)\\s*$', '', 'i'
            ),
            '\\s*(hdpe|pp|pet|petg)\\s*$', '', 'i'
          )
        )) AS product_family,
        COALESCE(
          (regexp_match(LOWER(poi.product_name), '(\\d+(\\.\\d+)?)\\s*(ml|l|gm|g|kg|ltr|litre|liter|cm|mm)'))[1]::numeric,
          0
        ) AS capacity_sort
      FROM active_orders ao
      JOIN production_order_items poi ON poi.production_order_id = ao.po_id
      LEFT JOIN proforma_invoices pi ON pi.id = ao.resolved_invoice_id
      LEFT JOIN proforma_invoice_items pii ON pii.id = poi.pi_item_id
      LEFT JOIN products p ON p.id = COALESCE(pii.product_id, (
        SELECT p2.id FROM products p2 WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(pii.product_name)) LIMIT 1
      ))
      WHERE COALESCE(poi.production_status, 'Pending') = 'Pending'
        AND (poi.ordered_quantity::numeric - poi.ready_quantity::numeric) > 0
        ${materialCondition}
    )
    SELECT
      product_family AS "productFamily",
      product_name AS "productName",
      MAX(weight) AS weight,
      MAX(colour) AS colour,
      MAX(colour_code) AS "colourCode",
      MAX(material_type) AS "materialType",
      SUM((ordered_quantity - ready_quantity)::numeric) AS "totalQuantity",
      COUNT(DISTINCT po_id) AS "orderCount",
      array_agg(DISTINCT po_id) AS "orderIds"
    FROM product_lines
    GROUP BY product_family, product_name, weight_norm, colour_norm, capacity_sort
    HAVING SUM((ordered_quantity - ready_quantity)::numeric) > 0
    ORDER BY product_family, capacity_sort, colour_norm, weight_norm
  `);

  const groups = (results.rows || []).map((r: any) => ({
    productFamily: r.productFamily || r.productName,
    productName: r.productName,
    weight: r.weight,
    colour: r.colour,
    colourCode: r.colourCode || null,
    materialType: r.materialType || "HDPE",
    totalQuantity: Number(r.totalQuantity),
    orderCount: Number(r.orderCount),
    orderIds: r.orderIds as number[],
  }));

  const materialSummary: Record<string, { productCount: number; totalPending: number }> = {};
  for (const g of groups) {
    const mt = g.materialType;
    if (!materialSummary[mt]) materialSummary[mt] = { productCount: 0, totalPending: 0 };
    materialSummary[mt].productCount++;
    materialSummary[mt].totalPending += g.totalQuantity;
  }

  return {
    groups,
    totalGroups: groups.length,
    totalPieces: groups.reduce((s: number, g: any) => s + g.totalQuantity, 0),
    materialSummary,
  };
}

export async function getManufacturingSummaryDetail(
  user: PermissionUser,
  filter: { productName: string; weight: string; colour: string } | { orderIds: number[] }
) {
  if ("orderIds" in filter && !filter.orderIds.length) return { items: [] };

  let results: any;

  if ("productName" in filter) {
    const colourFilter = filter.colour === "N/A"
      ? sql`(p.bottle_colour IS NULL OR p.bottle_colour = '')`
      : sql`lower(TRIM(COALESCE(NULLIF(p.bottle_colour, ''), 'N/A'))) = lower(TRIM(${filter.colour}))`;
    const weightFilter = filter.weight === "-"
      ? sql`(COALESCE(NULLIF(pii.weight, ''), p.bottle_weight) IS NULL OR COALESCE(NULLIF(pii.weight, ''), p.bottle_weight) = '')`
      : sql`lower(TRIM(COALESCE(NULLIF(pii.weight, ''), p.bottle_weight, ''))) = lower(TRIM(${filter.weight}))`;

    results = await db.execute(sql`
      WITH active_orders AS (
        SELECT po.id AS po_id
        FROM production_orders po
        WHERE po.status NOT IN ('Completed', 'Cancelled', 'Ready To Dispatch')
      )
      SELECT DISTINCT
        po.id AS "orderId",
        po.status,
        po.production_unit AS "productionUnit",
        po.created_by_role AS "createdByRole",
        po.is_delayed AS "isDelayed",
        po.created_at AS "createdAt",
        po.expected_dispatch_date AS "expectedDispatchDate",
        po.priority,
        COALESCE(pi.customer_name, '') AS "customerName",
        COALESCE(pi.company_name, '') AS "companyName",
        COALESCE(pi.invoice_number, '') AS "piNumber",
        COALESCE(pi.sales_owner_id::text, '') AS "salesOwnerId",
        (SELECT u.name FROM users u WHERE u.id = pi.sales_owner_id) AS "salesPerson",
        pii.quantity::numeric AS "quantity",
        pii.unit AS "unit"
      FROM active_orders ao
      JOIN production_orders po ON po.id = ao.po_id
      JOIN proforma_invoices pi ON pi.id = po.proforma_invoice_id
      JOIN proforma_invoice_items pii ON pii.invoice_id = pi.id
      LEFT JOIN products p ON p.id = COALESCE(pii.product_id, (
        SELECT p2.id FROM products p2 WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(pii.product_name)) LIMIT 1
      ))
      WHERE TRIM(LOWER(pii.product_name)) = TRIM(LOWER(${filter.productName}))
        AND ${weightFilter}
        AND ${colourFilter}
        AND pi.is_deleted = false
      ORDER BY po.created_at DESC
    `);
  } else {
    results = await db.execute(sql`
      SELECT DISTINCT
        po.id AS "orderId",
        po.status,
        po.production_unit AS "productionUnit",
        po.created_by_role AS "createdByRole",
        po.is_delayed AS "isDelayed",
        po.created_at AS "createdAt",
        po.expected_dispatch_date AS "expectedDispatchDate",
        po.priority,
        COALESCE(pi.customer_name, '') AS "customerName",
        COALESCE(pi.company_name, '') AS "companyName",
        COALESCE(pi.invoice_number, '') AS "piNumber",
        COALESCE(pi.sales_owner_id::text, '') AS "salesOwnerId",
        (SELECT u.name FROM users u WHERE u.id = pi.sales_owner_id) AS "salesPerson",
        pii.quantity::numeric AS "quantity",
        pii.unit AS "unit"
      FROM production_orders po
      JOIN proforma_invoices pi ON pi.id = po.proforma_invoice_id
      JOIN proforma_invoice_items pii ON pii.invoice_id = pi.id
      LEFT JOIN products p ON p.id = COALESCE(pii.product_id, (
        SELECT p2.id FROM products p2 WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(pii.product_name)) LIMIT 1
      ))
      WHERE po.id = ANY(${filter.orderIds}::int[])
        AND pi.is_deleted = false
      ORDER BY po.created_at DESC
    `);
  }

  const items = (results.rows || []).map((r: any) => ({
    orderId: Number(r.orderId),
    customerName: r.customerName || "-",
    companyName: r.companyName || "-",
    piNumber: r.piNumber || "-",
    salesPerson: r.salesPerson || "-",
    quantity: Number(r.quantity),
    unit: r.unit || "Pcs",
    status: r.status,
    productionUnit: r.productionUnit || "-",
    createdByRole: r.createdByRole,
    isDelayed: r.isDelayed,
    createdAt: r.createdAt,
    expectedDispatchDate: r.expectedDispatchDate,
    priority: r.priority,
  }));

  // Mask customer identity for production-only users
  if (isProductionOnlyRole(user.role)) {
    for (const item of items) {
      // Look up customer code from contacts via PI
      const [pi] = await db.select({ contactId: proformaInvoicesTable.contactId })
        .from(proformaInvoicesTable)
        .where(eq(proformaInvoicesTable.invoiceNumber, item.piNumber === "-" ? "" : item.piNumber))
        .limit(1);
      if (pi?.contactId) {
        const [contact] = await db.select({ customerCode: contactsTable.customerCode })
          .from(contactsTable)
          .where(eq(contactsTable.id, pi.contactId))
          .limit(1);
        item.customerName = contact?.customerCode || "[No Code]";
      } else {
        item.customerName = "[No Code]";
      }
      item.companyName = "";
    }
  }

  return { items };
}

/**
 * Repair stuck orders: sync product line statuses with order statuses.
 * Called on-demand to fix data inconsistencies.
 */
export async function repairStuckOrders(user: PermissionUser): Promise<{
  fixedToReadyToDispatch: number;
  fixedToProductionOnGoing: number;
  fixedDispatchStatus: number;
  details: string[];
}> {
  const details: string[] = [];
  let fixedToReadyToDispatch = 0;
  let fixedToProductionOnGoing = 0;
  let fixedDispatchStatus = 0;

  // ── FIX A: Orders where ALL product lines are "Ready" but order is NOT "Ready To Dispatch" ──
  const nonTerminalStatuses = ["Pending", "Production On Going", "Packaging"];
  const allNonTerminal = await db.select().from(productionOrdersTable)
    .where(or(...nonTerminalStatuses.map(s => eq(productionOrdersTable.status, s))));

  for (const order of allNonTerminal) {
    const items = await db.select({ productionStatus: productionOrderItemsTable.productionStatus })
      .from(productionOrderItemsTable)
      .where(eq(productionOrderItemsTable.productionOrderId, order.id));

    if (items.length === 0) continue;

    const allReady = items.every(i => i.productionStatus === "Ready");
    if (!allReady) continue;

    // All products Ready but order is stuck — force transition
    const now = new Date();
    await db.update(productionOrdersTable).set({
      status: "Ready To Dispatch",
      dispatchStatus: "Pending Dispatch",
      isFrozen: true,
      readyAt: now,
      updatedAt: now,
      updatedBy: user.id,
    } as any).where(eq(productionOrdersTable.id, order.id));

    await addTimelineEntry(db, order.id, "Ready To Dispatch",
      `SYSTEM REPAIR: ${order.status} → Ready To Dispatch\nAll product lines were Ready but order status was not updated.`,
      user.id);

    await writeAuditTrail(db, {
      productionOrderId: order.id, action: "system_repair",
      oldValue: order.status, newValue: "Ready To Dispatch",
      changedById: user.id, changedByName: user.name || "System",
      reason: "Data repair: all product lines were Ready but order status was stuck",
    });

    details.push(`Order #${order.id}: ${order.status} → Ready To Dispatch (all products ready)`);
    fixedToReadyToDispatch++;
  }

  // ── FIX B: Orders stuck in "Packaging" where NOT all products are Ready → revert to "Production On Going" ──
  const packagingOrders = await db.select().from(productionOrdersTable)
    .where(eq(productionOrdersTable.status, "Packaging"));

  for (const order of packagingOrders) {
    const items = await db.select({ productionStatus: productionOrderItemsTable.productionStatus })
      .from(productionOrderItemsTable)
      .where(eq(productionOrderItemsTable.productionOrderId, order.id));

    if (items.length === 0) continue;

    const allReady = items.every(i => i.productionStatus === "Ready");
    if (allReady) continue; // Already handled in Fix A

    // Not all products ready — order shouldn't be in Packaging
    const now = new Date();
    await db.update(productionOrdersTable).set({
      status: "Production On Going",
      isFrozen: true,
      updatedAt: now,
      updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, order.id));

    await addTimelineEntry(db, order.id, "Production On Going",
      `SYSTEM REPAIR: Packaging → Production On Going\nNot all product lines are Ready.`,
      user.id);

    await writeAuditTrail(db, {
      productionOrderId: order.id, action: "system_repair",
      oldValue: "Packaging", newValue: "Production On Going",
      changedById: user.id, changedByName: user.name || "System",
      reason: "Data repair: not all product lines are Ready, reverting from Packaging",
    });

    details.push(`Order #${order.id}: Packaging → Production On Going (not all products ready)`);
    fixedToProductionOnGoing++;
  }

  // ── FIX C: Orders with status "Ready To Dispatch" but null dispatchStatus ──
  const rtdOrders = await db.select().from(productionOrdersTable)
    .where(and(
      eq(productionOrdersTable.status, "Ready To Dispatch"),
      sql`${productionOrdersTable.dispatchStatus} IS NULL`
    ));

  for (const order of rtdOrders) {
    await db.update(productionOrdersTable).set({
      dispatchStatus: "Pending Dispatch",
      updatedAt: new Date(),
      updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, order.id));

    details.push(`Order #${order.id}: set dispatchStatus = "Pending Dispatch" (was null)`);
    fixedDispatchStatus++;
  }

  return { fixedToReadyToDispatch, fixedToProductionOnGoing, fixedDispatchStatus, details };
}
