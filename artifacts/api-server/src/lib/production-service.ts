import {
  db, productionOrdersTable, productionTimelineTable, productionNotesTable,
  productionMessagesTable, proformaInvoicesTable, proformaInvoiceItemsTable,
  usersTable, contactsTable, dealsTable, activitiesTable,
  productionAuditTrailTable, notificationsTable,
  PRODUCTION_STATUSES, VALID_STATUS_TRANSITIONS,
  type ProductionStatus, type NoteType,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, or, inArray, type SQL } from "drizzle-orm";
import { getActivePiForDeal } from "./proforma-service";
import { notifyProductionUsers, notifyDealEvent } from "./notification-service";
import { logActivity, formatTimestamp } from "./activity-logger";
import { canAccessProduction, type PermissionUser } from "./permission-service";

// ── Status Machine ──

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidNextStatuses(currentStatus: string): string[] {
  return VALID_STATUS_TRANSITIONS[currentStatus] || [];
}

// ── Audit Trail ──

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

// ── Timeline Helper ──

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

// ── Activity Log Helper ──

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

// ── Notification Helpers ──

async function notifySalesOfProductionEvent(params: {
  productionOrderId: number;
  invoiceId: number | null;
  title: string;
  message: string;
  excludeUserId: number;
}) {
  const { invoiceId, title, message, excludeUserId, productionOrderId } = params;
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

// ── Order Enrichment ──

export async function enrichProductionOrder(order: any) {
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

  let dispatchCompletedByUser = null;
  if (order.dispatchCompletedBy) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.dispatchCompletedBy));
    if (u) dispatchCompletedByUser = u;
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

  return {
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
    items: items.map((i: any) => ({
      ...i,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      amount: Number(i.amount),
      gstPercent: Number(i.gstPercent || 0),
    })),
    contact,
    assignedManager,
    lastUpdatedBy,
    acceptedBy,
    startedBy,
    cancelledBy,
    dispatchCompletedByUser,
    timeline: timelineWithUsers,
    notes: notesWithUsers,
    validNextStatuses: getValidNextStatuses(order.status),
  };
}

// ── Scenario 2: Accept Order ──

export async function acceptOrder(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Accepted")) {
    return { error: `Cannot accept order in "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Accepted",
    acceptedById: user.id,
    acceptedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Accepted", `Order accepted by ${user.name}`, user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Order Accepted",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Accepted",
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
    excludeUserId: user.id,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Scenario 3: Update Planning ──

export async function updatePlanning(
  user: PermissionUser,
  orderId: number,
  data: { machine?: string; expectedStartDate?: string; expectedCompletionDate?: string; expectedDispatchDate?: string; priority?: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const planningStatuses = ["Pending", "Accepted", "Planning"];
  if (!planningStatuses.includes(order.status)) {
    return { error: `Cannot update planning for order in "${order.status}" status. Planning is only editable before Machine Running.`, status: 400 };
  }

  const now = new Date();
  const updateData: any = { updatedBy: user.id, updatedAt: now };

  if (data.machine !== undefined) updateData.plannedMachine = data.machine;
  if (data.expectedStartDate !== undefined) updateData.expectedStartDate = data.expectedStartDate;
  if (data.expectedCompletionDate !== undefined) updateData.expectedCompletionDate = data.expectedCompletionDate;
  if (data.expectedDispatchDate !== undefined) updateData.expectedDispatchDate = data.expectedDispatchDate;
  if (data.priority !== undefined) updateData.priority = data.priority;

  if (order.status === "Pending") {
    updateData.status = "Planning";
  }

  await db.update(productionOrdersTable).set(updateData).where(eq(productionOrdersTable.id, orderId));

  if (order.status === "Pending") {
    await addTimelineEntry(db, orderId, "Planning", `Planning started by ${user.name}`, user.id);
  }

  if (data.notes) {
    await db.insert(productionNotesTable).values({
      productionOrderId: orderId, note: data.notes, noteType: "planning", createdBy: user.id,
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

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Scenario 4: Start Production (Machine Running) ──

export async function startProduction(
  user: PermissionUser,
  orderId: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Machine Running")) {
    return { error: `Cannot start production from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Machine Running",
    startedById: user.id,
    startedAt: now,
    isFrozen: true,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Machine Running", `Production started by ${user.name}. Machine frozen.`, user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Started (Machine Running)",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Machine Running",
    changedById: user.id, changedByName: user.name || "",
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Production Started",
    message: `Order #${order.id} has entered Machine Running stage. PI is now frozen.`,
    excludeUserId: user.id,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Scenario 6: Handle PI Modification (Freeze Logic) ──

export async function handlePiModification(
  user: PermissionUser,
  productionOrderId: number,
  newPiVersion: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, productionOrderId));
  if (!order) return { error: "Production order not found", status: 404 };

  if (order.status === "Pending" || order.status === "Accepted" || order.status === "Planning") {
    await db.update(productionOrdersTable).set({
      piVersionAtCreation: newPiVersion, updatedAt: new Date(), updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, productionOrderId));
    await addTimelineEntry(db, productionOrderId, order.status, `PI updated to Version ${newPiVersion}. Auto-synced.`, user.id);
    await logProductionActivity(db, {
      dealId: order.dealId, contactId: null, eventName: `PI Modified — Auto-synced to Version ${newPiVersion}`,
      orderId: productionOrderId, userName: user.name || "", createdBy: user.id,
    });
    return { action: "auto_synced", order: await enrichProductionOrder(order) };
  }

  if (order.status === "Machine Running" || order.status === "Quality Check") {
    await db.update(productionOrdersTable).set({
      piVersionAtCreation: newPiVersion, updatedAt: new Date(), updatedBy: user.id,
    }).where(eq(productionOrdersTable.id, productionOrderId));
    await addTimelineEntry(db, productionOrderId, order.status, `PI modified to Version ${newPiVersion}. Awaiting production approval.`, user.id);
    await logProductionActivity(db, {
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

    return { action: "approval_required", order: await enrichProductionOrder(order) };
  }

  if (order.status === "Completed") {
    await addTimelineEntry(db, productionOrderId, order.status, `PI modified after production completion. No auto-sync.`, user.id);
    return { action: "rejected", message: "Production already completed. Suggest creating a new deal." };
  }

  // Ready For Dispatch: notify but don't auto-sync
  if (order.status === "Ready For Dispatch") {
    await addTimelineEntry(db, productionOrderId, order.status, `PI modified to Version ${newPiVersion}. Dispatch stage — review required.`, user.id);
    await notifyProductionUsers({
      productionUnit: order.productionUnit || "Himatnagar",
      title: "PI Modified — Dispatch Review",
      message: `Order #${order.id}: PI has been modified by Sales at dispatch stage. Version ${newPiVersion}. Review changes.`,
      link: `/production/orders/${order.id}`,
      relatedId: order.id, relatedType: "production_order",
      type: "production_pi_modified", excludeUserId: user.id,
    });
    return { action: "dispatch_review", order: await enrichProductionOrder(order) };
  }

  return { action: "no_action" };
}

// ── Scenario 6: Approve/Reject Modification ──

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

    if (order.dealId) {
      const pi = await getActivePiForDeal(db, order.dealId);
      if (pi) {
        // Sync production order to point to the approved PI
        await db.update(productionOrdersTable).set({
          proformaInvoiceId: pi.id,
          piVersionAtCreation: pi.version,
          updatedAt: now,
          updatedBy: user.id,
        }).where(eq(productionOrdersTable.id, orderId));

        await writeAuditTrail(db, {
          productionOrderId: orderId, action: "pi_modification_approved",
          changedById: user.id, changedByName: user.name || "",
          reason: `PI Version ${pi.version} approved — production order synced`,
        });
      }
    }

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Modification Approved",
      message: `Order #${orderId}: Production has accepted the PI modification.`,
      excludeUserId: user.id,
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
      excludeUserId: user.id,
    });

    await logProductionActivity(db, {
      dealId: order.dealId, contactId: null, eventName: "PI Modification Rejected",
      orderId, userName: user.name || "", createdBy: user.id,
    });
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Generic Status Update ──

export async function updateStatus(
  user: PermissionUser,
  orderId: number,
  targetStatus: string,
  notes?: string
): Promise<any> {
  if (!PRODUCTION_STATUSES.includes(targetStatus as ProductionStatus)) {
    return { error: "Invalid status", status: 400 };
  }

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, targetStatus)) {
    return { error: `Cannot move from "${order.status}" to "${targetStatus}"`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: targetStatus, updatedBy: user.id, updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, targetStatus, notes || null, user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: `Production Status Changed → ${targetStatus}`,
    orderId, details: notes || undefined, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: targetStatus,
    changedById: user.id, changedByName: user.name || "",
    reason: notes,
  });

  const statusNotifications: Record<string, { title: string; toSales: boolean }> = {
    "Quality Check": { title: "Quality Check", toSales: true },
    "Ready For Dispatch": { title: "Ready For Dispatch", toSales: true },
    "Completed": { title: "Completed", toSales: true },
  };

  const notifyInfo = statusNotifications[targetStatus];
  if (notifyInfo) {
    const [inv] = order.proformaInvoiceId
      ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, createdBy: proformaInvoicesTable.createdBy })
          .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
      : [];

    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: `Production ${notifyInfo.title}`,
      message: `Order #${inv?.invoiceNumber || orderId} is now: ${targetStatus}${notes ? ` - ${notes}` : ""}`,
      excludeUserId: user.id,
    });
  }

  if (targetStatus === "Ready For Dispatch") {
    await createDispatchRecord(orderId, order, user);
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Scenario 10: Cancel Order ──

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

  await addTimelineEntry(db, orderId, "Cancelled", `Cancelled by ${user.name}. Reason: ${reason}`, user.id);
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
    excludeUserId: user.id,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

// ── Scenario 8: Add Note ──

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

// ── Scenario 9: Check Delayed Orders ──

export async function checkDelayedOrders(): Promise<{ checked: number; markedDelayed: number }> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const activeOrders = await db
    .select()
    .from(productionOrdersTable)
    .where(and(
      inArray(productionOrdersTable.status, ["Accepted", "Planning", "Machine Running", "Quality Check"]),
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
        excludeUserId: 0,
      });

      markedDelayed++;
    }
  }

  return { checked: activeOrders.length, markedDelayed };
}

// ── Messages ──

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
    if (order.createdById && order.createdById !== user.id) notifyUserIds.push(order.createdById);
    if (order.proformaInvoiceId) {
      const [inv] = await db.select({ createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
      if (inv?.createdBy && inv.createdBy !== user.id && !notifyUserIds.includes(inv.createdBy)) notifyUserIds.push(inv.createdBy);
    }
  } else {
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const a of admins) {
      if (a.id !== user.id && !notifyUserIds.includes(a.id)) notifyUserIds.push(a.id);
    }
  }

  for (const uid of notifyUserIds) {
    await db.insert(notificationsTable).values({
      userId: uid, type: "production_message",
      title: `New message from ${user.name}`,
      message: message.trim().slice(0, 200),
      link: `/production/orders/${orderId}`,
      relatedId: orderId, relatedType: "production_order",
    });
  }

  return { message: newMessage };
}

// ── Dashboard KPIs ──

export async function getDashboard(user: PermissionUser, unitFilter?: string) {
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

  const allOrders = await db.select().from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return {
    pendingCount: allOrders.filter(o => o.status === "Pending").length,
    acceptedCount: allOrders.filter(o => o.status === "Accepted").length,
    planningCount: allOrders.filter(o => o.status === "Planning").length,
    machineRunningCount: allOrders.filter(o => o.status === "Machine Running").length,
    qualityCheckCount: allOrders.filter(o => o.status === "Quality Check").length,
    readyForDispatchCount: allOrders.filter(o => o.status === "Ready For Dispatch").length,
    completedToday: allOrders.filter(o => {
      if (o.status !== "Completed") return false;
      const t = o.updatedAt ? new Date(o.updatedAt) : null;
      return t && t >= todayStart;
    }).length,
    delayedOrders: allOrders.filter(o => o.isDelayed).length,
    totalOrders: allOrders.length,
  };
}

// ── List Orders ──

export async function listOrders(
  user: PermissionUser,
  filters: {
    status?: string; priority?: string; search?: string;
    dateFrom?: string; dateTo?: string; createdBy?: string;
    unit?: string; page?: string; limit?: string;
  }
) {
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
  if (filters.priority && filters.priority !== "all") conditions.push(eq(productionOrdersTable.priority, filters.priority));
  if (filters.createdBy && filters.createdBy !== "all") {
    if (filters.createdBy === "sales") conditions.push(eq(productionOrdersTable.createdByRole, "sales"));
    else if (filters.createdBy === "production_and_support") conditions.push(eq(productionOrdersTable.createdByRole, "production_and_support"));
    else { const uid = parseInt(filters.createdBy, 10); if (!isNaN(uid)) conditions.push(eq(productionOrdersTable.createdById, uid)); }
  }
  if (filters.dateFrom) conditions.push(gte(productionOrdersTable.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lte(productionOrdersTable.createdAt, new Date(filters.dateTo + "T23:59:59")));

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

  const enriched = await Promise.all(orders.map(enrichProductionOrder));

  return { data: enriched, total: count, page: pageNum, totalPages: Math.ceil(count / pageSize) };
}

// ── Single Order Detail ──

export async function getOrderDetail(user: PermissionUser, orderId: number) {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  if (user.role !== "admin" && order.productionUnit) {
    const u = (user as any).unit || "All";
    if (u !== "All" && u !== order.productionUnit) {
      return { error: "Forbidden: production unit not accessible", status: 403 };
    }
  }

  return { order: await enrichProductionOrder(order) };
}

// ── Audit Trail ──

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

// ── Pending Summary ──

export async function getPendingSummary(user: PermissionUser, unitFilter?: string) {
  const effectiveUnit = ((user as any).unit !== "All" && user.role !== "admin")
    ? (user as any).unit
    : (unitFilter && unitFilter !== "All" && unitFilter !== "all" ? unitFilter : undefined);

  const results = await db.execute(sql`
    WITH resolved_invoices AS (
      SELECT
        po.id AS po_id,
        COALESCE(
          po.proforma_invoice_id,
          (SELECT pi2.id FROM proforma_invoices pi2
           JOIN deals d ON d.contact_id = pi2.contact_id
           WHERE d.id = po.deal_id AND pi2.is_deleted = false
           ORDER BY pi2.created_at DESC LIMIT 1)
        ) AS resolved_invoice_id
      FROM production_orders po
      WHERE po.status NOT IN ('Completed', 'Cancelled')
    )
    SELECT
      pii.product_name AS "productName",
      SUM(pii.quantity::numeric) AS "totalQuantity",
      COUNT(DISTINCT ri.po_id) AS "orderCount",
      array_agg(DISTINCT ri.po_id) AS "orderIds"
    FROM resolved_invoices ri
    JOIN proforma_invoices pi ON pi.id = ri.resolved_invoice_id
    JOIN proforma_invoice_items pii ON pii.invoice_id = pi.id
    WHERE ri.resolved_invoice_id IS NOT NULL
      AND pi.is_deleted = false
      ${effectiveUnit && effectiveUnit !== "all" ? sql`AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = ri.po_id AND po.production_unit = ${effectiveUnit})` : sql``}
    GROUP BY pii.product_name
    HAVING SUM(pii.quantity::numeric) > 0
    ORDER BY SUM(pii.quantity::numeric) DESC
  `);

  const summary = (results.rows || []).map((r: any) => ({
    productName: r.productName,
    totalPendingQuantity: Number(r.totalQuantity),
    orderCount: Number(r.orderCount),
    orderIds: r.orderIds,
  }));

  return {
    products: summary,
    totalPendingProducts: summary.length,
    totalPendingPieces: summary.reduce((s: number, r: any) => s + r.totalPendingQuantity, 0),
  };
}

// ── Pending Requirements ──

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
      ${conditions.length > 0 ? sql`AND ${conditions[0]}` : sql``}
    GROUP BY oi.product_name, gramage
    HAVING SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric) > 0
    ORDER BY (SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric)) DESC
  `);

  return results.rows || [];
}

// ── Reports ──

export async function getReports(user: PermissionUser, filters: { unit?: string; status?: string; dateFrom?: string; dateTo?: string }) {
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

  const allOrders = await db.select().from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrdersTable.createdAt));

  const enriched = await Promise.all(allOrders.map(enrichProductionOrder));

  const byStatus: Record<string, number> = {};
  const byUnit: Record<string, number> = {};
  for (const o of enriched) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    byUnit[o.productionUnit || "Unassigned"] = (byUnit[o.productionUnit || "Unassigned"] || 0) + 1;
  }

  return { data: enriched, stats: { totalOrders: enriched.length, byStatus, byUnit } };
}

// ── Progress by Deal (Sales view) ──

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
    plannedMachine: po.plannedMachine, expectedStartDate: po.expectedStartDate,
    expectedCompletionDate: po.expectedCompletionDate, isFrozen: po.isFrozen,
    isDelayed: po.isDelayed, startedAt: po.startedAt, acceptedAt: po.acceptedAt,
  };
}

// ── Production by Contact ──

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
  };
}

// ── Modified Since (polling helper) ──

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

// ── Dispatch Record Creation (auto on Ready For Dispatch) ──

async function createDispatchRecord(orderId: number, order: any, user: PermissionUser) {
  try {
    const { dispatchTable, dispatchItemsTable } = await import("@workspace/db");
    const { generateId } = await import("../lib/id-generator");

    const [existingDispatch] = await db.select().from(dispatchTable)
      .where(eq(dispatchTable.productionOrderId, orderId)).limit(1);
    if (existingDispatch) return;

    const dispatchNumber = await generateId("dispatch");
    const [invoice] = order.proformaInvoiceId
      ? await db.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
      : [];

    const [newDispatch] = await db.insert(dispatchTable).values({
      dispatchNumber, productionOrderId: orderId, status: "Pending",
      dispatchAddress: invoice?.address || invoice?.addressLine1 || null,
      remarks: order.productionRemarks || null, createdBy: user.id,
    }).returning();

    if (order.proformaInvoiceId) {
      const piItems = await db.select().from(proformaInvoiceItemsTable)
        .where(eq(proformaInvoiceItemsTable.invoiceId, order.proformaInvoiceId));
      for (const item of piItems) {
        await db.insert(dispatchItemsTable).values({
          dispatchId: newDispatch.id, productName: item.productName,
          quantity: String(item.quantity || 0), batchNumber: (item as any).productCode || null,
        });
      }
    }
  } catch (err) {
    console.error("Auto-create dispatch record failed:", err);
  }
}

// ── Scenario 11: Complete Dispatch ──

export async function completeDispatch(
  user: PermissionUser,
  orderId: number,
  data: { transportName?: string; transportDetails?: string; builtyUrl?: string }
): Promise<any> {
  if (user.role !== "admin" && user.role !== "production_and_support") {
    return { error: "Only production & support or admin users can complete dispatch", status: 403 };
  }

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (order.status !== "Ready For Dispatch") {
    return { error: "Order must be in 'Ready For Dispatch' status to complete dispatch", status: 400 };
  }

  const now = new Date();

  await db.update(productionOrdersTable).set({
    status: "Completed",
    transportName: data.transportName || null,
    transportDetails: data.transportDetails || null,
    builtyUrl: data.builtyUrl || null,
    dispatchCompletedAt: now,
    dispatchCompletedBy: user.id,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Completed",
    `Dispatch completed by ${user.name}${data.transportName ? `. Transport: ${data.transportName}` : ""}`,
    user.id);

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "dispatch_completed",
    oldValue: order.status, newValue: "Completed",
    changedById: user.id, changedByName: user.name || "",
    reason: data.transportName ? `Transport: ${data.transportName}` : undefined,
  });

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Dispatch Completed",
    orderId, details: `Transport: ${data.transportName || "-"}\nDetails: ${data.transportDetails || "-"}`,
    userName: user.name || "", createdBy: user.id,
  });

  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, createdBy: proformaInvoicesTable.createdBy, contactId: proformaInvoicesTable.contactId })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Dispatch Completed",
    message: `Order #${invoice?.invoiceNumber || orderId} has been dispatched. Transport: ${data.transportName || "-"}${data.transportDetails ? `\nDetails: ${data.transportDetails}` : ""}`,
    excludeUserId: user.id,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}
