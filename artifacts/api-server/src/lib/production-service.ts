import {
  db, productionOrdersTable, productionTimelineTable, productionNotesTable,
  productionMessagesTable, proformaInvoicesTable, proformaInvoiceItemsTable,
  usersTable, contactsTable, dealsTable, activitiesTable, ordersTable,
  productionAuditTrailTable, notificationsTable, productsTable,
  productionOrderItemsTable, orderItemsTable,
  PRODUCTION_STATUSES, VALID_STATUS_TRANSITIONS,
  VALID_DISPATCH_TRANSITIONS, PRODUCT_LINE_STATUSES,
  type ProductionStatus, type NoteType, type ProductLineStatus,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, or, inArray, notInArray, ilike, isNull, isNotNull, asc, type SQL } from "drizzle-orm";
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
      bottleWeight: item.weight || product?.bottleWeight || null,
      capColour: product?.capColour || null,
      hsnCode: item.hsnCode || null,
      orderedQuantity: String(item.quantity),
      readyQuantity: "0",
      productionStatus: "Pending",
    });
  }
}

// ═══════════════════════════════════════════════════
// FAST-TRACK DISPATCH (shortcut — bypasses step-by-step workflow)
// ═══════════════════════════════════════════════════

export async function fastTrackReady(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  if (["Completed", "Cancelled"].includes(order.status)) {
    return { error: `Cannot fast-track a "${order.status}" order`, status: 400 };
  }
  if (order.status === "Ready To Dispatch") {
    return { error: "Order is already Ready To Dispatch", status: 400 };
  }
  if (order.dispatchStatus && order.dispatchStatus !== "Pending Dispatch") {
    return { error: `Cannot fast-track order already in dispatch flow ("${order.dispatchStatus}")`, status: 400 };
  }

  const now = new Date();

  await syncProductionOrderItems(orderId, order.proformaInvoiceId);

  await db.update(productionOrderItemsTable).set({
    readyQuantity: productionOrderItemsTable.orderedQuantity,
    productionStatus: "Ready",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  }).where(eq(productionOrderItemsTable.productionOrderId, orderId));

  await db.update(productionOrdersTable).set({
    status: "Ready To Dispatch",
    dispatchStatus: "Pending Dispatch",
    isFrozen: true,
    readyAt: now,
    updatedBy: user.id,
    updatedAt: now,
  } as any).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Ready To Dispatch",
    `Status: ${order.status} → Ready To Dispatch (Fast-Track)\nAll items marked 100% ready. Fast-tracked by ${user.name}.`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Fast-Track Dispatch",
    orderId, details: "All items marked ready and order fast-tracked to Ready To Dispatch",
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "fast_track_dispatch",
    oldValue: order.status, newValue: "Ready To Dispatch",
    changedById: user.id, changedByName: user.name || "",
  });

  const masterOrderNumber = await resolveMasterOrderNumber(order);

  await notifySupportOfReadyForDispatch({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready To Dispatch",
    message: `Order ${masterOrderNumber || orderId} fast-tracked to Ready To Dispatch. Support action required.`,
    excludeUserId: user.id,
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready To Dispatch",
    message: `Order ${masterOrderNumber || orderId} fast-tracked to Ready To Dispatch. Support team has been notified.`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!, user) };
}

// Resolve the canonical Master Order number for a production order. A production
// order and its master "orders" row are created together when a deal/PI is
// converted and share the same dealId, so we look the master up via that link.
// Falls back to the production order's own formattedOrderId (legacy/unlinked).
async function resolveMasterOrderNumber(order: { dealId?: number | null; formattedOrderId?: string | null }): Promise<string | null> {
  if (order.dealId) {
    const [mo] = await db
      .select({ orderNumber: ordersTable.orderNumber })
      .from(ordersTable)
      .where(eq(ordersTable.dealId, order.dealId))
      .orderBy(asc(ordersTable.createdAt))
      .limit(1);
    if (mo?.orderNumber) return mo.orderNumber;
  }
  return order.formattedOrderId || null;
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
        bottleWeight: piItem.weight || product?.bottleWeight || null,
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
        bottleWeight: piItem.weight || product?.bottleWeight || null,
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

// ═══════════════════════════════════════════════════
// SALES ORDER ITEMS SYNC (order_items)
// Guarantees the Sales Order page (order-detail-global.tsx, which reads
// orderItemsTable via enrichOrder) is an EXACT reflection of the converted
// Proforma Invoice — item-for-item, field-for-field. Previously only
// production_order_items were re-synced on PI edits, so new products added to
// a converted PI never reached the Sales Order.
//
// Strategy: DELETE all existing order_items for the linked order, then INSERT
// the current PI items. Runtime state (readyQuantity / dispatchedQuantity /
// status / batchNumber / packing quantities) is carried over from the row being
// replaced when a product of the same name + colour is still present, so an
// in-flight order keeps its progress instead of being reset.
// ═══════════════════════════════════════════════════
export async function syncOrderItemsFromPi(
  piId: number | null,
  dealId: number | null | undefined,
  txDb?: typeof db
): Promise<{ orderId: number | null; deleted: number; inserted: number }> {
  const d = txDb || db;
  if (!piId || !dealId) return { orderId: null, deleted: 0, inserted: 0 };

  // 1. Find the linked Sales Order via the shared dealId (repeat orders are
  //    created with dealId = null, so this resolves to the conversion order).
  const [order] = await d
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.dealId, dealId), eq(ordersTable.isDeleted, false)))
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  if (!order) return { orderId: null, deleted: 0, inserted: 0 };

  const piItems = await d.select().from(proformaInvoiceItemsTable)
    .where(eq(proformaInvoiceItemsTable.invoiceId, piId));
  if (piItems.length === 0) return { orderId: order.id, deleted: 0, inserted: 0 };

  // 2. Snapshot existing runtime state keyed by product name + colour so an item
  //    still present after the edit keeps its ready/dispatch progress.
  const existingRows = await d.select().from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));
  const stateByKey = new Map<string, typeof orderItemsTable.$inferSelect>();
  for (const row of existingRows) {
    const key = `${(row.productName || "").toLowerCase().trim()}::${(row.colour || "").toLowerCase().trim()}`;
    stateByKey.set(key, row);
  }

  // 3. DELETE all existing order items (guaranteed parity — no leftovers).
  await d.delete(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));

  // 4. INSERT the current PI items, mapped field-for-field.
  let inserted = 0;
  for (const piItem of piItems) {
    const key = `${(piItem.productName || "").toLowerCase().trim()}::${(piItem.bottleColour || "").toLowerCase().trim()}`;
    const prev = stateByKey.get(key);
    await d.insert(orderItemsTable).values({
      orderId: order.id,
      productId: piItem.productId ?? null,
      productName: piItem.productName,
      hsnCode: piItem.hsnCode || null,
      bottleType: piItem.bottleType || null,
      bottleWeight: piItem.weight || null,
      colour: piItem.bottleColour || null,
      capacity: piItem.capacity || null,
      quantity: String(piItem.quantity),
      unit: piItem.unit || "Pcs",
      rate: String(piItem.rate || 0),
      gstPercent: String(piItem.gstPercent || 0),
      amount: String(piItem.amount || 0),
      status: prev?.status || "Pending",
      readyQuantity: prev?.readyQuantity ? String(prev.readyQuantity) : "0",
      dispatchedQuantity: prev?.dispatchedQuantity ? String(prev.dispatchedQuantity) : "0",
      dispatchStatus: prev?.dispatchStatus || "Pending",
      batchNumber: prev?.batchNumber || null,
      gramage: prev?.gramage || null,
      remarks: prev?.remarks || null,
      linerPackingQty: prev?.linerPackingQty ?? 0,
      tciBoraQty: prev?.tciBoraQty ?? 0,
      normalBoraQty: prev?.normalBoraQty ?? 0,
    });
    inserted++;
  }

  // 5. Keep order totals in parity with the PI items (same convention as the
  //    Won-deal conversion in deals.ts — order freight is left untouched so
  //    support-side freight adjustments are preserved).
  const totalAmount = piItems.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalGst = piItems.reduce((s, i) => s + Number(i.amount || 0) * Number(i.gstPercent || 0) / 100, 0);
  const grandTotal = totalAmount + totalGst + Number(order.freight || 0);
  await d.update(ordersTable).set({
    totalAmount: String(totalAmount),
    totalGst: String(totalGst),
    grandTotal: String(grandTotal),
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, order.id));

  return { orderId: order.id, deleted: existingRows.length, inserted };
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

export async function recalculateOrderStatus(orderId: number, triggeredBy?: { id: number; name: string }, options?: { allowRevert?: boolean }): Promise<void> {
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

  // ── Backward transition (product line REVERTED) ──
  // A reverted item means the order is no longer as far along as its status
  // claims (e.g. an item marked Ready by mistake flipped the whole order to
  // "Ready To Dispatch"). Roll the order back to the freshly computed stage,
  // as long as the dispatch workflow has NOT advanced past "Pending Dispatch"
  // (an order already being loaded/delivered must not be yanked backwards).
  if (options?.allowRevert) {
    const stages = ["Pending", "Production On Going", "Packaging", "Ready To Dispatch"];
    const fromIdx = stages.indexOf(order.status);
    const toIdx = stages.indexOf(newStatus);
    const isBackward = fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx;
    if (isBackward) {
      const dispatchAdvanced = !!order.dispatchStatus && order.dispatchStatus !== "Pending Dispatch";
      if (dispatchAdvanced) return;

      const now = new Date();
      const revertData: any = {
        status: newStatus,
        updatedAt: now,
        updatedBy: triggeredBy?.id || null,
        dispatchStatus: null,
        readyAt: null,
      };
      if (newStatus === "Pending") revertData.isFrozen = false;

      await db.update(productionOrdersTable).set(revertData).where(eq(productionOrdersTable.id, orderId));

      const actorName = triggeredBy?.name || "System";
      await addTimelineEntry(db, orderId, newStatus,
        `Auto revert: ${order.status} → ${newStatus}\nProduct line rolled back.\nBy: ${actorName}`,
        triggeredBy?.id || 0);

      await writeAuditTrail(db, {
        productionOrderId: orderId, action: "auto_status_revert",
        oldValue: order.status, newValue: newStatus,
        changedById: triggeredBy?.id || 0, changedByName: actorName,
        reason: "Product line reverted to a previous state",
      });

      await logProductionActivity(db, {
        dealId: order.dealId, contactId: null,
        eventName: `Auto Status: ${order.status} → ${newStatus}`,
        orderId, details: "Product line reverted — order moved back to an earlier stage.",
        userName: actorName, createdBy: triggeredBy?.id || 0,
      });
      return;
    }
  }

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

  // Revert detection: moving a product line to an EARLIER stage (Ready → In
  // Production / Pending, or In Production → Pending). This lets users undo a
  // mistaken "Ready" without needing a separate endpoint.
  const oldStatus = item.productionStatus;
  const isRevert = PRODUCT_LINE_STATUSES.indexOf(newStatus) < PRODUCT_LINE_STATUSES.indexOf(oldStatus as ProductLineStatus);

  const now = new Date();
  const orderedQty = Number(item.orderedQuantity);
  let readyQty = data.readyQuantity !== undefined ? data.readyQuantity : Number(item.readyQuantity);

  // A reverted item is no longer complete: reset the produced quantity so the
  // "remaining <= 0 → Ready" auto-advance below can never force it back.
  if (isRevert) readyQty = 0;
  if (readyQty < 0) readyQty = 0;
  if (readyQty > orderedQty) readyQty = orderedQty;

  const updateData: any = { productionStatus: newStatus, readyQuantity: String(readyQty), updatedAt: now };

  if (isRevert) {
    updateData.completedAt = null;
    if (newStatus === "Pending") updateData.startedAt = null;
  }
  if (newStatus === "In Production" && !item.startedAt) {
    updateData.startedAt = now;
  }
  if (newStatus === "Ready") {
    readyQty = orderedQty;
    updateData.readyQuantity = String(orderedQty);
    updateData.completedAt = now;
  }

  if (!isRevert) {
    const remaining = orderedQty - readyQty;
    if (readyQty > 0 && readyQty < orderedQty && newStatus !== "Ready") {
      updateData.productionStatus = "In Production";
    }
    if (remaining <= 0 && newStatus !== "Ready") {
      updateData.productionStatus = "Ready";
      updateData.readyQuantity = String(orderedQty);
      updateData.completedAt = now;
    }
  }

  await db.update(productionOrderItemsTable).set(updateData).where(eq(productionOrderItemsTable.id, itemId));

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

  await recalculateOrderStatus(orderId, { id: user.id, name: user.name || "Unknown" }, { allowRevert: isRevert });

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

export async function enrichProductionOrder(order: any, user?: { id?: number; role: string }) {
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
    const product = i.productId
      ? allProducts.find(p => p.id === i.productId)
      : productMap.get(i.productName?.toLowerCase()?.trim());
    return {
      ...i,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      amount: Number(i.amount),
      gstPercent: Number(i.gstPercent || 0),
      materialType: product?.materialType || null,
      machineType: product?.machineType || null,
      bottleColour: i.bottleColour || product?.bottleColour || null,
      bottleWeight: i.weight || product?.bottleWeight || null,
      capColour: product?.capColour || null,
      productCode: product?.productCode || null,
    };
  });

  // ── Master order linkage (AUTHORITATIVE for customer identity) ──
  // A production order and its master "orders" row are created together when a
  // deal/PI is converted and share the same dealId. The master order is the
  // CANONICAL source for BOTH the order number AND the customer:
  //   production_orders -> orders (via dealId) -> contacts (via orders.contactId)
  // The customer shown here MUST equal the global Orders page exactly, so the
  // customer is resolved ONLY through the master orders row — never from the
  // PI/deal's own contact, which can differ (e.g. orders.customerName is
  // "Silky (EML_14)" while the PI/deal contact points at a different record).
  let masterOrder: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    companyName: string | null;
    contactId: number | null;
  } | null = null;
  const masterDealId = order.dealId || invoice?.dealId || null;
  if (masterDealId) {
    const [mo] = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.customerName,
        companyName: ordersTable.companyName,
        contactId: ordersTable.contactId,
      })
      .from(ordersTable)
      .where(eq(ordersTable.dealId, masterDealId))
      .orderBy(asc(ordersTable.createdAt))
      .limit(1);
    masterOrder = mo || null;
  }
  const masterOrderNumber = masterOrder?.orderNumber || null;

  // Customer contact is resolved STRICTLY through the master orders row
  // (orders.contactId -> contacts). The PI contact / deal contact are only
  // fallbacks for orphan production orders that have no linked master order.
  let contact = null;
  if (masterOrder?.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, masterOrder.contactId));
    if (c) contact = c;
  }
  if (!contact && invoice?.contactId) {
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

  // Master order linkage: a production order and its master "orders" row are
  // created together when a deal/PI is converted and share the same dealId.
  // The canonical master order (id + orderNumber) is resolved above and drives
  // both the SAME order code (e.g. EML_2627_35) shown on the global Orders page
  // AND the authoritative customer identity (customerName/companyName/contact).

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
    displayOrderId: masterOrderNumber || order.formattedOrderId || (order.createdAt ? `EML_${getFinancialYear(new Date(order.createdAt))}_${order.id}` : `#${order.id}`),
    masterOrderId: masterOrder?.id ?? null,
    masterOrderNumber,
    customerCode: contact?.customerCode || null,
    // Company Name = the official billing Trade Name from the linked Proforma
    // Invoice ONLY — strictly no fallback (per display spec).
    companyName: invoice?.tradeName || null,
    // Customer = the client/lead identity resolved from the customers table
    // (contacts): company_name first, individual name as fallback. The master
    // order snapshot / PI customer name remain only as a last resort for
    // orphan production orders that have no resolvable contact.
    customerName: contact?.companyName || contact?.name || masterOrder?.customerName || invoice?.customerName || null,
    orderNumber: masterOrderNumber || order.formattedOrderId || (order.createdAt ? `EML_${getFinancialYear(new Date(order.createdAt))}_${order.id}` : `#${order.id}`),
    // Per-user read state: the "new order" blue dot and the "updated" amber dot
    // reflect ONLY whether the REQUESTING user has seen them. One user opening
    // the order must not clear the dots for their teammates.
    isRead: (user?.id != null ? (order.readBy ?? []).includes(user.id) : !!order.isRead),
    isUpdated: order.isUpdated === true && (user?.id == null || !(order.updatedReadBy ?? []).includes(user.id)),
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

    // Search by production order number (PO-2026-XXX / formattedOrderId)
    const lowerQ = q.toLowerCase();
    matchingOrders.push(sql`LOWER(${productionOrdersTable.formattedOrderId}) LIKE ${`%${lowerQ}%`}`);

    // Search by linked Sales Order number (orders.formattedOrderId/orderNumber via dealId)
    const matchingSalesOrders = await db.select({ dealId: ordersTable.dealId }).from(ordersTable).where(and(
      or(
        ilike(ordersTable.formattedOrderId, `%${q}%`),
        ilike(ordersTable.orderNumber, `%${q}%`)
      ),
      eq(ordersTable.isDeleted, false),
      isNotNull(ordersTable.dealId)
    ));
    if (matchingSalesOrders.length > 0) {
      matchingOrders.push(inArray(productionOrdersTable.dealId, matchingSalesOrders.map(o => o.dealId!)));
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

// ── PI modification gate (based on linked Production Order status) ──
// A Proforma Invoice can be edited only while its production order is still
// pre-dispatch (Pending / Accepted / Planning / In Production / Packing /
// Ready For Dispatch). Once goods are loaded onto a vehicle (In Transport) or
// the order is Completed, the invoice is locked and edits must be rejected.
export const PI_LOCKED_STATUSES = ["In Transport", "Completed"] as const;

export const PI_LOCKED_ERROR =
  "Goods have already been dispatched for this order. You cannot modify this invoice. Please create a new deal/order for new items.";

// Resolve the production order linked to a PI. Tries the direct
// proformaInvoiceId link first, then falls back to the deal link (covers
// versioned PIs where the order points at the newest active invoice).
export async function findLinkedProductionOrder(
  piId: number,
  dealId: number | null | undefined
): Promise<typeof productionOrdersTable.$inferSelect | null> {
  if (dealId) {
    const [byDeal] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.dealId, dealId))
      .orderBy(desc(productionOrdersTable.createdAt))
      .limit(1);
    if (byDeal) return byDeal;
  }
  const [byPi] = await db
    .select()
    .from(productionOrdersTable)
    .where(eq(productionOrdersTable.proformaInvoiceId, piId))
    .limit(1);
  return byPi || null;
}

// True when a PI edit is permitted for the given production order status.
export function canModifyPiForProductionStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return !(PI_LOCKED_STATUSES as readonly string[]).includes(status);
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

  const now = new Date();

  // 1. ALWAYS sync PI items into production_order_items, regardless of the
  //    production order's current status. resyncProductionOrderItems inserts any
  //    PI item without a matching production_order_items row (new items are
  //    always created with productionStatus "Pending" and readyQuantity 0),
  //    updates matched rows, and removes leftover Pending-only rows.
  const syncResult = await resyncProductionOrderItems(productionOrderId, order.proformaInvoiceId, txDb);

  // 1b. ALWAYS sync the linked Sales Order's items (order_items) so the Sales
  //     Order page is an exact reflection of the updated PI — production
  //     parity alone (production_order_items) is not enough.
  if (order.dealId && order.proformaInvoiceId) {
    await syncOrderItemsFromPi(order.proformaInvoiceId, order.dealId, txDb);
  }

  // 2. New items were added → unconditionally revert the order to "Pending" and
  //    reset workflow progress flags so the production team knows there is new
  //    work to do. This applies regardless of prior status (e.g. an order that
  //    was Ready For Dispatch / In Transport / Completed with new items added).
  if (syncResult.added > 0) {
    await d.update(productionOrdersTable).set({
      status: "Pending",
      isFrozen: false,
      dispatchStatus: null,
      readyAt: null,
      startedAt: null,
      startedById: null,
      acceptedAt: null,
      acceptedById: null,
      packingCompletedAt: null,
      packingCompletedById: null,
      transportBookedAt: null,
      transportBookedById: null,
      dispatchedAt: null,
      dispatchedById: null,
      dispatchCompletedAt: null,
      dispatchCompletedBy: null,
      deliveredAt: null,
      deliveredById: null,
      deliveryDate: null,
      lrNumber: null,
      isDelayed: false,
      delayedAt: null,
      delayReason: null,
      needsReprint: true,
      isUpdated: true,
      // New PI modification = nobody has seen the latest update yet; the amber
      // dot must show for every production user until each one opens the order.
      updatedReadBy: [],
      piVersionAtCreation: newPiVersion,
      updatedAt: now,
      updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, productionOrderId));

    const reverted = order.status !== "Pending";

    await addTimelineEntry(d, productionOrderId, "Pending",
      reverted
        ? `PI updated to Version ${newPiVersion}: ${syncResult.added} new item(s) added. Order reverted from ${order.status} → Pending.`
        : `PI updated to Version ${newPiVersion}: ${syncResult.added} new item(s) added.`,
      user.id);

    await logProductionActivity(d, {
      dealId: order.dealId, contactId: null,
      eventName: `PI Modified — ${syncResult.added} New Item(s) Added${reverted ? " — Order reverted to Pending" : ""}`,
      orderId: productionOrderId, userName: user.name || "", createdBy: user.id,
    });

    await writeAuditTrail(d, {
      productionOrderId, action: "pi_modified_items_added",
      oldValue: reverted ? order.status : null, newValue: reverted ? "Pending" : null,
      changedById: user.id, changedByName: user.name || "",
      reason: `PI Version ${newPiVersion} — ${syncResult.added} item(s) added${reverted ? `; status reverted ${order.status} → Pending` : ""}`,
    });

    await notifyProductionUsers({
      productionUnit: order.productionUnit || "Himatnagar",
      title: "PI Modified — New Items Added",
      message: `Order #${order.id}: ${syncResult.added} new item(s) added to PI Version ${newPiVersion}${reverted ? `; order reverted from ${order.status} → Pending` : ""}. New production required.`,
      link: `/production/orders/${order.id}`,
      relatedId: order.id, relatedType: "production_order",
      type: "production_pi_modified", excludeUserId: user.id,
    });

    const [updatedOrder] = await d.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, productionOrderId));
    return { action: "reverted_to_pending", order: await enrichProductionOrder(updatedOrder!, user) };
  }

  // 3. No new items — bump PI version + reprint flag (existing rows re-synced
  //    above; the order's workflow status/progress is left untouched).
  await d.update(productionOrdersTable).set({
    piVersionAtCreation: newPiVersion,
    needsReprint: true,
    isUpdated: true,
    // New PI modification = nobody has seen the latest update yet.
    updatedReadBy: [],
    updatedAt: now,
    updatedBy: user.id,
  }).where(eq(productionOrdersTable.id, productionOrderId));

  await addTimelineEntry(d, productionOrderId, order.status,
    `PI updated to Version ${newPiVersion}. Synced (${syncResult.updated} updated, ${syncResult.deleted} removed).`,
    user.id);
  await logProductionActivity(d, {
    dealId: order.dealId, contactId: null,
    eventName: `PI Modified — Synced (${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.deleted} removed)`,
    orderId: productionOrderId, userName: user.name || "", createdBy: user.id,
  });

  return { action: "synced", order: await enrichProductionOrder(order, user) };
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

        // Keep the Sales Order's items in parity with the approved PI as well.
        if (order.dealId) {
          await syncOrderItemsFromPi(pi.id, order.dealId, tx as unknown as typeof db);
        }

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
    // Fresh cancellation → production must acknowledge before it drops off
    // the default orders list.
    cancellationAcknowledged: false,
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

/**
 * Acknowledge an order cancellation.
 * A production user confirms they have seen a cancelled order, which removes it
 * from the default active orders list (only unacknowledged cancellations stay
 * visible). Idempotent: acknowledging an already-acknowledged order is a
 * no-op success.
 */
export async function acknowledgeCancellation(
  user: PermissionUser,
  orderId: number,
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (order.status !== "Cancelled") {
    return { error: `Only cancelled orders can be acknowledged. Current status: ${order.status}`, status: 400 };
  }
  if (order.cancellationAcknowledged) {
    return { order: await enrichProductionOrder(order, user) };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    cancellationAcknowledged: true,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Cancelled", `Cancellation acknowledged by ${user.name}.`, user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Cancellation Acknowledged",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "cancellation_acknowledged",
    oldValue: "false", newValue: "true",
    changedById: user.id, changedByName: user.name || "",
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
  const messages = await db.select().from(productionMessagesTable)
    .where(eq(productionMessagesTable.productionOrderId, orderId))
    .orderBy(productionMessagesTable.createdAt);

  // Enrich the conversation with the order context so every chat surface
  // (notification modal, sales order page, production order page, lead page)
  // can render the Company Name + Order Number in the header without extra calls.
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  let orderNumber: string | null = null;
  let companyName: string | null = null;
  let customerName: string | null = null;
  if (order) {
    orderNumber = order.formattedOrderId || `#${order.id}`;
    if (order.proformaInvoiceId) {
      const [inv] = await db.select({
        tradeName: proformaInvoicesTable.tradeName,
        customerName: proformaInvoicesTable.customerName,
        invoiceNumber: proformaInvoicesTable.invoiceNumber,
      }).from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
      if (inv) {
        companyName = inv.tradeName || null;
        customerName = inv.customerName || null;
        orderNumber = orderNumber || inv.invoiceNumber || null;
      }
    }
  }

  return { orderId, orderNumber, companyName, customerName, messages };
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
  const pushRecipient = (id?: number | null) => {
    if (id && id !== user.id && !notifyUserIds.includes(id)) notifyUserIds.push(id);
  };

  // Production-side recipient: the assigned production manager (if not the sender).
  pushRecipient(order.assignedProductionManagerId);
  pushRecipient(order.createdById);

  // Sales-side recipients: the sales order owner / creator (when a sales order is
  // linked via the deal), the PI creator, and the contact's sales owner. This
  // guarantees the Sales Owner always receives the chat notification even when the
  // production order was created from a deal with no proforma invoice yet.
  let salesOrderId: number | null = null;
  if (order.dealId) {
    const [salesOrder] = await db.select({ id: ordersTable.id, salesOwnerId: ordersTable.salesOwnerId, createdBy: ordersTable.createdBy })
      .from(ordersTable)
      .where(and(eq(ordersTable.dealId, order.dealId), eq(ordersTable.isDeleted, false)))
      .limit(1);
    if (salesOrder) {
      salesOrderId = salesOrder.id;
      pushRecipient(salesOrder.salesOwnerId);
      pushRecipient(salesOrder.createdBy);
    }
  }

  if (order.proformaInvoiceId) {
    const [inv] = await db.select({ createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
      .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
    if (inv) {
      pushRecipient(inv.createdBy);
      if (inv.contactId) {
        const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, inv.contactId));
        pushRecipient(contact?.salesOwnerId);
      }
    }
  }

  if (user.role !== "production") {
    // Sales/Support/Admin → notify the full production-side team: production
    // managers, production_and_support (Support) users and admins. Without the
    // production_and_support role here, Support users never saw chat messages
    // sent from the Sales workspace.
    const productionUsers = await db.select({ id: usersTable.id }).from(usersTable)
      .where(or(eq(usersTable.role, "production"), eq(usersTable.role, "production_and_support"), eq(usersTable.role, "admin")));
    for (const u of productionUsers) pushRecipient(u.id);
  }

  // Resolve recipient roles so each notification link targets the recipient's
  // workspace (the "conversation" lives in both workspaces).
  const recipientRows = notifyUserIds.length
    ? await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, notifyUserIds))
    : [];
  const roleById = new Map(recipientRows.map((u) => [u.id, u.role]));

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
    // CRITICAL: the routing link respects the recipient's workspace — Sales users
    // land on /orders/:salesOrderId, everyone else on /production/orders/:orderId.
    const link = roleById.get(uid) === "sales" && salesOrderId
      ? `/orders/${salesOrderId}`
      : `/production/orders/${orderId}`;
    await createNotification({
      createdById: user.id,
      userId: uid,
      type: "production_message",
      title: chatTitle,
      message: `[${senderDept}] ${user.name}: ${message.trim().slice(0, 200)}`,
      link,
      relatedId: newMessage.id,
      relatedType: "production_message",
    });
  }

  return { message: newMessage };
}

// ── Shared Machine-wise Production Report core ──
// Both the Machine-wise Production Report page and the Production Dashboard KPI
// cards derive their totals from this single source so they can NEVER diverge.
// The status buckets, row-building SQL and material source are identical.

const PENDING_ST = ["Pending", "Pending Verification", "Confirmed", "Production Pending", "Accepted", "Planning"];
const IN_PROD_ST = ["In Production", "Production On Going", "Production Started", "Production Running"];
const DORMANT_ST = ["Ready", "Completed", "Ready For Dispatch", "In Transport", "Delivered", "Cancelled"];

type MachineReportRow = {
  orderId: number; orderNumber: string | null; status: string; productionUnit: string | null; createdAt: Date | null;
  productName: string; machineType: string | null; materialType: string | null;
  bottleColour: string | null; bottleWeight: string | null; productCode: string | null;
  quantity: number; readyQuantity: number; productionStatus: string;
};

// Production statuses that require active machine work. A row is bucketed by its
// LINE productionStatus first, then falls back to the ORDER status. Anything not
// pending or in-production is "dormant" (Ready, Completed, RTD, In Transport, ...).
function statusBucket(row: MachineReportRow): "pending" | "inProduction" | "dormant" {
  const ps = row.productionStatus;
  if (PENDING_ST.includes(ps)) return "pending";
  if (IN_PROD_ST.includes(ps)) return "inProduction";
  if (DORMANT_ST.includes(ps)) return "dormant";
  const os = row.status;
  if (PENDING_ST.includes(os)) return "pending";
  if (IN_PROD_ST.includes(os)) return "inProduction";
  return "dormant";
}

/**
 * Builds the raw product-line rows shared by the Machine Report and the
 * Dashboard. Orders are excluded when Completed / Delivered / Cancelled (unless
 * an explicit status filter is given). Line material comes from
 * production_order_items.material_type — the single source the Machine Report
 * uses for its client-side material filter — so server-side material filtering
 * here matches it exactly.
 */
async function buildMachineReportRows(
  user: PermissionUser,
  filters: { unit?: string; status?: string; dateFrom?: string; dateTo?: string; origin?: string; material?: string }
): Promise<MachineReportRow[]> {
  const conditions = buildOrderConditions(user, {
    status: filters.status,
    unit: filters.unit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    origin: filters.origin,
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

  if (orders.length === 0) return [];

  const orderIds = orders.map(o => o.id);
  const productLines = await db.select().from(productionOrderItemsTable)
    .where(inArray(productionOrderItemsTable.productionOrderId, orderIds));

  const invoiceToOrder = new Map(orders.map(o => [o.proformaInvoiceId, o]));

  const productRows: MachineReportRow[] = [];

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
        materialType: null, bottleColour: item.bottleColour || null, bottleWeight: item.weight || null, productCode: null,
        quantity: Number(item.quantity), readyQuantity: 0, productionStatus: order.status === "Completed" ? "Ready" : "Pending",
      });
    }
  }

  // Material filter — applied on production_order_items.material_type (the exact
  // source the Machine Report page filters client-side on), keeping both pages
  // consistent for HDPE / PET / PP.
  if (filters.material && filters.material !== "All" && filters.material !== "all") {
    return productRows.filter(r => r.materialType === filters.material);
  }
  return productRows;
}

export async function getDashboard(user: PermissionUser, unitFilter?: string, originFilter?: string, startDate?: string, endDate?: string, materialFilter?: string) {
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

  const materialActive = !!materialFilter && materialFilter !== "All" && materialFilter !== "all";
  // Material filter for the order-level "Completed today" KPI only (products join).
  const materialCompletedCondition: SQL | undefined = materialActive
    ? sql`EXISTS (
        SELECT 1
        FROM production_order_items poi
        JOIN proforma_invoice_items pii ON pii.id = poi.pi_item_id
        JOIN products p ON p.id = COALESCE(pii.product_id, (
          SELECT p2.id FROM products p2
          WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(pii.product_name))
          LIMIT 1
        ))
        WHERE poi.production_order_id = ${productionOrdersTable.id}
          AND lower(COALESCE(p.material_type, '')) = lower(${materialFilter})
      )`
    : undefined;

  // Active (non-terminal) order statuses — excludes Completed / Cancelled / Delivered
  const activeStatuses = [
    "Pending", "Accepted", "Planning",
    "Production On Going", "In Production",
    "Packaging", "Packing",
    "Ready To Dispatch", "Ready For Dispatch", "In Transport",
  ];

  // ── Order-level KPIs (Active Orders / Delayed / Pending Dispatch) ──
  // Single query over active orders joined to their (soft-deletable) PI so the
  // counts only include orders whose invoice still exists. Deduplicated by order.
  const allRows = await db
    .select({
      orderId: productionOrdersTable.id,
      orderStatus: productionOrdersTable.status,
      piIsDeleted: proformaInvoicesTable.isDeleted,
      orderIsDelayed: productionOrdersTable.isDelayed,
    })
    .from(productionOrdersTable)
    .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, productionOrdersTable.proformaInvoiceId))
    .where(and(...conditions, inArray(productionOrdersTable.status, activeStatuses)));

  let delayedOrders = 0;
  let activeOrders = 0;
  let dispatchPendingCount = 0;
  const seenOrders = new Set<number>();
  for (const row of allRows) {
    // Exclude orders linked to soft-deleted proforma invoices
    if (row.piIsDeleted) continue;
    if (seenOrders.has(row.orderId)) continue;
    seenOrders.add(row.orderId);
    activeOrders++;
    if (row.orderIsDelayed) delayedOrders++;
    if (row.orderStatus === "Ready To Dispatch" || row.orderStatus === "Ready For Dispatch") dispatchPendingCount++;
  }

  // ── Piece KPIs (Total Bottles / Pending PCS / In Production PCS) ──
  // Reuse the EXACT Machine-wise Production Report row-building and status
  // bucketing (shared helper above) so both pages show IDENTICAL totals for the
  // same unit / origin / date / material filters.
  const rows = await buildMachineReportRows(user, {
    unit: unitFilter,
    origin: originFilter,
    dateFrom: startDate,
    dateTo: endDate,
    material: materialActive ? materialFilter : undefined,
  });

  let pendingPieces = 0;
  let inProductionPieces = 0;
  let readyPieces = 0;
  for (const row of rows) {
    const remaining = row.quantity - row.readyQuantity;
    const bucket = statusBucket(row);
    if (bucket === "pending") {
      if (remaining > 0) pendingPieces += remaining;
    } else if (bucket === "inProduction") {
      if (remaining > 0) inProductionPieces += remaining;
    } else if (row.productionStatus === "Ready") {
      if (row.readyQuantity > 0) readyPieces += row.readyQuantity;
    }
  }

  // Completed today — query separately using exact timestamp
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [{ completedTodayCount }] = await db
    .select({ completedTodayCount: sql<number>`count(*)::int` })
    .from(productionOrdersTable)
    .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, productionOrdersTable.proformaInvoiceId))
    .where(and(
      ...conditions,
      materialCompletedCondition,
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
  const productRows = await buildMachineReportRows(user, {
    status: filters.status,
    unit: filters.unit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (productRows.length === 0) {
    return {
      summary: { totalProducts: 0, totalBottles: 0, pending: 0, inProduction: 0, completed: 0 },
      materialBreakdown: [],
      orders: [],
    };
  }

  let filteredRows = productRows;
  if (filters.machineType && filters.machineType !== "All") {
    filteredRows = filteredRows.filter(r => r.machineType === filters.machineType);
  }
  if (filters.product && filters.product !== "All") {
    filteredRows = filteredRows.filter(r => r.productName === filters.product);
  }

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
    hideDelivered?: boolean;
    hideAcknowledgedCancellations?: boolean;
  }
) {
  const conditions = buildOrderConditions(user, filters);

  // Default active view: exclude fully delivered orders from the list so the
  // production team sees only work still in the pipeline. Skipped when the user
  // explicitly filters by dispatch status (e.g. selecting "Delivered").
  if (filters.hideDelivered && (!filters.dispatchStatus || filters.dispatchStatus === "all")) {
    conditions.push(or(
      isNull(productionOrdersTable.dispatchStatus),
      notInArray(productionOrdersTable.dispatchStatus, ["Delivered"])
    )!);
  }

  // Default active view: keep unacknowledged cancelled orders visible so
  // production can see and acknowledge them; drop off acknowledged ones. Skipped
  // when the user explicitly filters by status (e.g. selecting "Cancelled"
  // shows the full cancellation history).
  if (filters.hideAcknowledgedCancellations && (!filters.status || filters.status === "all")) {
    conditions.push(or(
      sql`${productionOrdersTable.status} <> 'Cancelled'`,
      eq(productionOrdersTable.cancellationAcknowledged, false)
    )!);
  }

  if (filters.search) {
    // Case-insensitive search across every source that contributes to the enriched
    // order display: the proforma invoice (customerName, companyName, invoiceNumber,
    // mobile), the parent contact reachable via PI.contactId or deal.contactId
    // (name, companyName, customerCode, mobile), the production order number itself
    // (formattedOrderId), and the linked Sales Order number (via dealId). Combined
    // with `or()` and appended to the shared `and()` conditions so it stacks with
    // status/origin/unit/priority.
    const searchPattern = `%${filters.search}%`;
    const lowerPattern = `%${filters.search.toLowerCase()}%`;

    const [matchingInvoices, matchingContacts, matchingSalesOrders] = await Promise.all([
      db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable).where(
        or(
          sql`LOWER(${proformaInvoicesTable.customerName}) LIKE ${lowerPattern}`,
          sql`LOWER(${proformaInvoicesTable.companyName}) LIKE ${lowerPattern}`,
          ilike(proformaInvoicesTable.invoiceNumber, searchPattern),
          sql`LOWER(${proformaInvoicesTable.mobile}) LIKE ${lowerPattern}`
        )
      ),
      db.select({ id: contactsTable.id }).from(contactsTable).where(
        or(
          sql`LOWER(${contactsTable.name}) LIKE ${lowerPattern}`,
          sql`LOWER(${contactsTable.companyName}) LIKE ${lowerPattern}`,
          sql`LOWER(${contactsTable.customerCode}) LIKE ${lowerPattern}`,
          sql`LOWER(${contactsTable.mobile}) LIKE ${lowerPattern}`
        )
      ),
      // Sales Order number — orders link to the production order via dealId
      db.select({ dealId: ordersTable.dealId }).from(ordersTable).where(
        and(
          eq(ordersTable.isDeleted, false),
          isNotNull(ordersTable.dealId),
          or(
            ilike(ordersTable.formattedOrderId, searchPattern),
            ilike(ordersTable.orderNumber, searchPattern)
          )
        )
      ),
    ]);

    const searchConditions: SQL[] = [
      // Order number stored directly on the production order
      ilike(productionOrdersTable.formattedOrderId, searchPattern),
    ];

    if (matchingSalesOrders.length > 0) {
      // Match the linked Sales Order's dealId
      const salesOrderDealIds = matchingSalesOrders
        .map(o => o.dealId)
        .filter((id): id is number => id != null);
      if (salesOrderDealIds.length > 0) {
        searchConditions.push(
          inArray(productionOrdersTable.dealId, salesOrderDealIds)
        );
      }
    }

    if (matchingInvoices.length > 0) {
      searchConditions.push(
        inArray(productionOrdersTable.proformaInvoiceId, matchingInvoices.map(i => i.id))
      );
    }

    if (matchingContacts.length > 0) {
      const contactIds = matchingContacts.map(c => c.id);
      // PI-linked orders whose PI points at a matching contact
      searchConditions.push(
        sql`${productionOrdersTable.proformaInvoiceId} IN (SELECT ${proformaInvoicesTable.id} FROM ${proformaInvoicesTable} WHERE ${inArray(proformaInvoicesTable.contactId, contactIds)})`
      );
      // Deal-linked orders whose deal points at a matching contact
      searchConditions.push(
        sql`${productionOrdersTable.dealId} IN (SELECT ${dealsTable.id} FROM ${dealsTable} WHERE ${inArray(dealsTable.contactId, contactIds)})`
      );
    }

    conditions.push(or(...searchConditions)!);
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

  // Unread production messages / voice notes for the current user, keyed by the
  // notification link, so the Production Orders list can flag orders with unseen
  // chat — mirroring the Sales-side Orders list behaviour.
  const unreadLinks = new Map<string, number>();
  try {
    const unreadRows = await db.select({ link: notificationsTable.link })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, user.id),
        isNull(notificationsTable.readAt),
        inArray(notificationsTable.type, ["production_message", "voice_note"])
      ));
    for (const row of unreadRows) {
      if (row.link) unreadLinks.set(row.link, (unreadLinks.get(row.link) || 0) + 1);
    }
  } catch { /* notifications table unavailable — flag nothing */ }

  const enriched = await Promise.all(orders.map(async (o) => {
    const e = await enrichProductionOrder(o, user);
    const unread = unreadLinks.get(`/production/orders/${o.id}`) || 0;
    e.hasUnreadMessages = unread > 0;
    e.unreadMessageCount = unread;
    return e;
  }));

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

export async function getPendingSummary(
  user: PermissionUser,
  unitFilter?: string,
  originFilter?: string,
  dateFrom?: string,
  dateTo?: string,
  materialFilter?: string,
) {
  const effectiveUnit = ((user as any).unit !== "All" && user.role !== "admin")
    ? (user as any).unit
    : (unitFilter && unitFilter !== "All" && unitFilter !== "all" ? unitFilter : undefined);

  const unitCondition = effectiveUnit && effectiveUnit !== "all"
    ? sql`AND po.production_unit = ${effectiveUnit}`
    : sql``;
  const originCondition = originFilter && originFilter !== "all"
    ? sql`AND po.created_by_role = ${originFilter}`
    : sql``;
  const dateFromCondition = dateFrom ? sql`AND po.created_at >= ${new Date(dateFrom)}` : sql``;
  const dateToCondition = dateTo ? sql`AND po.created_at <= ${new Date(dateTo + "T23:59:59")}` : sql``;
  const materialCondition = materialFilter && materialFilter !== "All" && materialFilter !== "all"
    ? sql`AND lower(COALESCE(NULLIF(oi.material_type, ''), 'N/A')) = lower(${materialFilter})`
    : sql``;
  const pendingStatusIn = sql.join(PENDING_ST.map(s => sql`${s}`), sql`, `);

  // Source of truth: production_order_items (the dynamic line-items table holding
  // ordered_quantity, ready_quantity, and remaining values).
  // Pending = SUM(ordered - ready) across all non-terminal orders. Uses the SAME
  // PENDING_ST status bucket + order-level exclusion ('Completed','Delivered',
  // 'Cancelled') and the SAME material source (production_order_items.material_type)
  // as the Dashboard KPI / Machine Report so totals never diverge.
  // Exclude items whose remaining has reached zero.
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
    WHERE po.status NOT IN ('Completed', 'Delivered', 'Cancelled')
      AND COALESCE(oi.production_status, 'Pending') IN (${pendingStatusIn})
      AND (oi.ordered_quantity::numeric - oi.ready_quantity::numeric) > 0
      ${unitCondition}
      ${originCondition}
      ${dateFromCondition}
      ${dateToCondition}
      ${materialCondition}
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
    companyName: invoice?.tradeName || null,
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

export async function getManufacturingSummary(
  user: PermissionUser,
  unitFilter?: string,
  originFilter?: string,
  materialFilter?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const effectiveUnit = ((user as any).unit !== "All" && user.role !== "admin")
    ? (user as any).unit
    : (unitFilter && unitFilter !== "All" && unitFilter !== "all" ? unitFilter : undefined);

  // ── Alignment with the Dashboard KPI (buildMachineReportRows) ──
  // 1. Same ORDER-level status exclusion: only Completed / Delivered / Cancelled.
  //    RTD / RFD / In Transport orders are kept (their lines are non-pending so they
  //    naturally drop out below) — matching the KPI exactly.
  // 2. No `proforma_invoice_id IS NOT NULL` requirement — orders without a PI link
  //    are NOT dropped from the summary (the KPI never required it).
  // 3. Line status uses the same PENDING_ST bucket as the KPI, not just literal
  //    'Pending' — otherwise Accepted / Planning / Confirmed items vanish.
  // 4. Material comes from the LINE's own material_type first (the exact source the
  //    KPI + Machine Report use) so PET items are never relabelled as HDPE or dropped;
  //    falls back to the linked product, then HDPE. Products stay a LEFT JOIN so a
  //    missing product link never discards a valid production item.
  const unitCondition = effectiveUnit && effectiveUnit !== "all"
    ? sql`AND po.production_unit = ${effectiveUnit}`
    : sql``;
  const originCondition = originFilter && originFilter !== "all"
    ? sql`AND po.created_by_role = ${originFilter}`
    : sql``;
  const dateFromCondition = dateFrom ? sql`AND po.created_at >= ${new Date(dateFrom)}` : sql``;
  const dateToCondition = dateTo ? sql`AND po.created_at <= ${new Date(dateTo + "T23:59:59")}` : sql``;

  const materialExpr = sql`COALESCE(NULLIF(poi.material_type, ''), NULLIF(p.material_type, ''), 'HDPE')`;
  const materialCondition = materialFilter && materialFilter !== "All" && materialFilter !== "all"
    ? sql`AND lower(${materialExpr}) = lower(${materialFilter})`
    : sql``;
  const pendingStatusIn = sql.join(PENDING_ST.map(s => sql`${s}`), sql`, `);

  const results = await db.execute(sql`
    WITH active_orders AS (
      SELECT po.id AS po_id, po.status, po.production_unit, po.created_by_role,
             po.proforma_invoice_id AS resolved_invoice_id
      FROM production_orders po
      WHERE po.status NOT IN ('Completed', 'Delivered', 'Cancelled')
        ${unitCondition}
        ${originCondition}
        ${dateFromCondition}
        ${dateToCondition}
    ),
    product_lines AS (
      SELECT
        poi.production_order_id AS po_id,
        poi.product_name,
        poi.production_status,
        poi.ordered_quantity,
        poi.ready_quantity,
        COALESCE(NULLIF(pii.weight, ''), NULLIF(p.bottle_weight, ''), '-') AS weight,
        COALESCE(NULLIF(pii.bottle_colour, ''), NULLIF(p.bottle_colour, ''), 'N/A') AS colour,
        COALESCE(NULLIF(p.bottle_colour_code, ''), '') AS colour_code,
        ${materialExpr} AS material_type,
        TRIM(LOWER(COALESCE(NULLIF(pii.weight, ''), NULLIF(p.bottle_weight, ''), '-'))) AS weight_norm,
        TRIM(LOWER(COALESCE(NULLIF(pii.bottle_colour, ''), NULLIF(p.bottle_colour, ''), 'N/A'))) AS colour_norm,
        COALESCE(pii.product_id, (
          SELECT p2.id FROM products p2 WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(poi.product_name)) LIMIT 1
        )) AS product_id,
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
      LEFT JOIN proforma_invoice_items pii ON pii.id = poi.pi_item_id
      LEFT JOIN products p ON p.id = COALESCE(pii.product_id, (
        SELECT p2.id FROM products p2 WHERE TRIM(LOWER(p2.name)) = TRIM(LOWER(pii.product_name)) LIMIT 1
      ))
      WHERE COALESCE(poi.production_status, 'Pending') IN (${pendingStatusIn})
        AND (poi.ordered_quantity::numeric - poi.ready_quantity::numeric) > 0
        ${materialCondition}
    )
    SELECT
      product_family AS "productFamily",
      product_name AS "productName",
      MAX(product_id) AS "productId",
      MAX(weight) AS weight,
      MAX(colour) AS colour,
      MAX(colour_code) AS "colourCode",
      MAX(material_type) AS "materialType",
      SUM((ordered_quantity - ready_quantity)::numeric) AS "totalQuantity",
      COUNT(DISTINCT po_id) AS "orderCount",
      array_agg(DISTINCT po_id) AS "orderIds"
    FROM product_lines
    GROUP BY product_family, product_name, product_id, weight_norm, colour_norm, capacity_sort
    HAVING SUM((ordered_quantity - ready_quantity)::numeric) > 0
    ORDER BY product_family, capacity_sort, colour_norm, weight_norm
  `);

  const groups = (results.rows || []).map((r: any) => ({
    productFamily: r.productFamily || r.productName,
    productName: r.productName,
    productId: r.productId ?? null,
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
      ? sql`(COALESCE(NULLIF(pii.bottle_colour, ''), NULLIF(p.bottle_colour, '')) IS NULL OR COALESCE(NULLIF(pii.bottle_colour, ''), NULLIF(p.bottle_colour, '')) = '')`
      : sql`lower(TRIM(COALESCE(NULLIF(pii.bottle_colour, ''), NULLIF(p.bottle_colour, ''), 'N/A'))) = lower(TRIM(${filter.colour}))`;
    const weightFilter = filter.weight === "-"
      ? sql`(COALESCE(NULLIF(pii.weight, ''), NULLIF(p.bottle_weight, '')) IS NULL OR COALESCE(NULLIF(pii.weight, ''), NULLIF(p.bottle_weight, '')) = '')`
      : sql`lower(TRIM(COALESCE(NULLIF(pii.weight, ''), NULLIF(p.bottle_weight, ''), '-'))) = lower(TRIM(${filter.weight}))`;

    results = await db.execute(sql`
      WITH active_orders AS (
        SELECT po.id AS po_id
        FROM production_orders po
        WHERE po.status NOT IN ('Completed', 'Delivered', 'Cancelled')
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
