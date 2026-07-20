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

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidNextStatuses(currentStatus: string): string[] {
  return VALID_STATUS_TRANSITIONS[currentStatus] || [];
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
    packingCompletedBy,
    transportBookedBy,
    timeline: timelineWithUsers,
    notes: notesWithUsers,
    validNextStatuses: getValidNextStatuses(order.status),
  };
}

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
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function updatePlanning(
  user: PermissionUser,
  orderId: number,
  data: { machine?: string; expectedStartDate?: string; expectedCompletionDate?: string; expectedDispatchDate?: string; priority?: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const planningStatuses = ["Pending", "Accepted", "Planning"];
  if (!planningStatuses.includes(order.status)) {
    return { error: `Cannot update planning for order in "${order.status}" status. Planning is only editable before In Production.`, status: 400 };
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
  if (order.status === "Pending" || order.status === "Accepted") {
    await notifySalesOfProductionEvent({
      productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
      title: "Planning Created",
      message: `Order #${orderId}: Production planning has been created with expected dates.`,
      excludeUserId: user.id, createdByRole: order.createdByRole,
    });
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function startProduction(
  user: PermissionUser,
  orderId: number,
  data?: { machine?: string; operatorName?: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "In Production")) {
    return { error: `Cannot start production from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  const updateData: any = {
    status: "In Production",
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

  const timelineNotes = [`Production started by ${user.name}. Machine frozen.`];
  if (data?.machine) timelineNotes.push(`Machine: ${data.machine}`);
  if (data?.operatorName) timelineNotes.push(`Operator: ${data.operatorName}`);

  await addTimelineEntry(db, orderId, "In Production", timelineNotes.join("\n"), user.id);
  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Production Started",
    orderId, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "In Production",
    changedById: user.id, changedByName: user.name || "",
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Production Started",
    message: `Order #${order.id} has entered In Production stage.${data?.machine ? ` Machine: ${data.machine}` : ""}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function completePacking(
  user: PermissionUser,
  orderId: number,
  data: { packingType: string; notes?: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Packing")) {
    return { error: `Cannot pack from "${order.status}" status`, status: 400 };
  }
  if (!["Bundle", "Packet"].includes(data.packingType)) {
    return { error: "Packing type must be 'Bundle' or 'Packet'", status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Packing",
    packingType: data.packingType,
    packingNotes: data.notes || null,
    packingCompletedById: user.id,
    packingCompletedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  const timelineText = [
    `Packing started by ${user.name}`,
    `Packing type: ${data.packingType}`,
  ];
  if (data.notes) timelineText.push(`Notes: ${data.notes}`);

  await addTimelineEntry(db, orderId, "Packing", timelineText.join("\n"), user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Packing Started",
    orderId, details: `Type: ${data.packingType}${data.notes ? `\nNotes: ${data.notes}` : ""}`,
    userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Packing",
    changedById: user.id, changedByName: user.name || "",
    reason: `Packing type: ${data.packingType}`,
  });

  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Packing Started",
    message: `Order #${order.id} is now in Packing. Type: ${data.packingType}`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function markReadyForDispatch(
  user: PermissionUser,
  orderId: number,
  notes?: string
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (!isValidTransition(order.status, "Ready For Dispatch")) {
    return { error: `Cannot mark ready from "${order.status}" status`, status: 400 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "Ready For Dispatch",
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "Ready For Dispatch",
    `Ready for dispatch. Marked by ${user.name}${notes ? `\n${notes}` : ""}`,
    user.id);

  await logProductionActivity(db, {
    dealId: order.dealId, contactId: null, eventName: "Ready For Dispatch",
    orderId, details: notes || undefined, userName: user.name || "", createdBy: user.id,
  });

  await writeAuditTrail(db, {
    productionOrderId: orderId, action: "status_change",
    oldValue: order.status, newValue: "Ready For Dispatch",
    changedById: user.id, changedByName: user.name || "", reason: notes,
  });

  // Notify Support that order is ready for dispatch
  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  await notifySupportOfReadyForDispatch({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready For Dispatch",
    message: `Order #${invoice?.invoiceNumber || orderId} is ready for dispatch. Support action required.`,
    excludeUserId: user.id,
  });

  // Also notify Sales
  await notifySalesOfProductionEvent({
    productionOrderId: orderId, invoiceId: order.proformaInvoiceId,
    title: "Ready For Dispatch",
    message: `Order #${invoice?.invoiceNumber || orderId} is ready for dispatch. Support team has been notified.`,
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function bookTransport(
  user: PermissionUser,
  orderId: number,
  data: { transportCompany: string; bookingNumber: string }
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };
  if (order.status !== "Ready For Dispatch") {
    return { error: "Order must be in 'Ready For Dispatch' status to book transport", status: 400 };
  }
  if (user.role !== "admin" && user.role !== "production_and_support") {
    return { error: "Only support or admin users can book transport", status: 403 };
  }

  const now = new Date();
  await db.update(productionOrdersTable).set({
    status: "In Transport",
    transportName: data.transportCompany,
    transportDetails: data.bookingNumber,
    transportBookedById: user.id,
    transportBookedAt: now,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  await addTimelineEntry(db, orderId, "In Transport",
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
  return { order: await enrichProductionOrder(updated!) };
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
  return { order: await enrichProductionOrder(updated!) };
}

export async function handlePiModification(
  user: PermissionUser,
  productionOrderId: number,
  newPiVersion: number
): Promise<any> {
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, productionOrderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const preProductionStatuses = ["Pending", "Accepted", "Planning"];
  const inProductionStatuses = ["In Production", "Packing"];

  if (preProductionStatuses.includes(order.status)) {
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

  if (inProductionStatuses.includes(order.status)) {
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

  if (order.status === "Ready For Dispatch" || order.status === "In Transport") {
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
  return { order: await enrichProductionOrder(updated!) };
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
    excludeUserId: user.id, createdByRole: order.createdByRole,
  });

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
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
      inArray(productionOrdersTable.status, ["Accepted", "Planning", "In Production", "Packing"]),
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

export async function getDashboard(user: PermissionUser, unitFilter?: string, originFilter?: string) {
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

  const allOrders = await db.select().from(productionOrdersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return {
    pendingCount: allOrders.filter(o => o.status === "Pending").length,
    acceptedCount: allOrders.filter(o => o.status === "Accepted").length,
    planningCount: allOrders.filter(o => o.status === "Planning").length,
    inProductionCount: allOrders.filter(o => o.status === "In Production").length,
    packingCount: allOrders.filter(o => o.status === "Packing").length,
    readyForDispatchCount: allOrders.filter(o => o.status === "Ready For Dispatch").length,
    inTransportCount: allOrders.filter(o => o.status === "In Transport").length,
    completedToday: allOrders.filter(o => {
      if (o.status !== "Completed") return false;
      const t = o.updatedAt ? new Date(o.updatedAt) : null;
      return t && t >= todayStart;
    }).length,
    delayedOrders: allOrders.filter(o => o.isDelayed).length,
    activeOrders: allOrders.filter(o => o.status !== "Completed" && o.status !== "Cancelled").length,
    totalOrders: allOrders.length,
  };
}

export async function listOrders(
  user: PermissionUser,
  filters: {
    status?: string; priority?: string; search?: string;
    dateFrom?: string; dateTo?: string; createdBy?: string;
    unit?: string; origin?: string; page?: string; limit?: string;
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
      WHERE po.status NOT IN ('Completed', 'Cancelled', 'In Transport')
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
            AND po.status NOT IN ('Completed', 'Cancelled', 'In Transport')
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

  const enriched = await Promise.all(allOrders.map(enrichProductionOrder));

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
