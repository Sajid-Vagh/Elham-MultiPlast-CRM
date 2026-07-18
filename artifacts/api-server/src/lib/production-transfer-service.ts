import {
  db, productionOrdersTable, productionTimelineTable,
  productionTransferHistoryTable, proformaInvoicesTable,
  contactsTable, usersTable, notificationsTable, ordersTable,
} from "@workspace/db";
import { eq, or, desc } from "drizzle-orm";
import { enrichProductionOrder } from "./production-service";
import { notifyProductionUsers } from "./notification-service";
import { formatTimestamp } from "./activity-logger";
import { type PermissionUser, isProductionUser, isAdmin } from "./permission-service";

export function canTransfer(user: PermissionUser): boolean {
  return isAdmin(user) || isProductionUser(user);
}

export async function transferOrder(
  user: PermissionUser,
  orderId: number,
  targetUnit: string,
  reason: string,
  remarks?: string
): Promise<any> {
  if (!canTransfer(user)) {
    return { error: "Only production, production & support, or admin users can transfer orders", status: 403 };
  }
  if (!targetUnit || typeof targetUnit !== "string") {
    return { error: "Target unit is required", status: 400 };
  }
  if (!reason || !reason.trim()) {
    return { error: "Transfer reason is required", status: 400 };
  }

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  if (!order) return { error: "Production order not found", status: 404 };

  const previousUnit = order.productionUnit || "Unassigned";
  const now = new Date();

  await db.update(productionOrdersTable).set({
    productionUnit: targetUnit,
    previousProductionUnit: previousUnit,
    updatedBy: user.id,
    updatedAt: now,
  }).where(eq(productionOrdersTable.id, orderId));

  // Sync production unit to linked orders table
  if (order.dealId) {
    await db.update(ordersTable).set({
      productionUnit: targetUnit,
      updatedAt: now,
    }).where(eq(ordersTable.dealId, order.dealId));
  }

  await db.insert(productionTransferHistoryTable).values({
    productionOrderId: orderId,
    fromUnit: previousUnit,
    toUnit: targetUnit,
    transferredById: user.id,
    reason: reason.trim(),
    remarks: remarks || null,
  });

  await db.insert(productionTimelineTable).values({
    productionOrderId: orderId,
    status: order.status,
    notes: `Transferred from ${previousUnit} to ${targetUnit} by ${user.name}. Reason: ${reason}`,
    createdBy: user.id,
  });

  const [invoice] = order.proformaInvoiceId
    ? await db.select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, contactId: proformaInvoicesTable.contactId, createdBy: proformaInvoicesTable.createdBy })
        .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId))
    : [];

  const targetUnitUsers = await db
    .select({ id: usersTable.id, role: usersTable.role, unit: usersTable.unit })
    .from(usersTable)
    .where(or(
      eq(usersTable.role, "production"),
      eq(usersTable.role, "production_and_support"),
      eq(usersTable.role, "admin"),
    ));

  for (const tu of targetUnitUsers) {
    if (tu.id !== user.id) {
      const userUnit = tu.unit || "All";
      if (userUnit === "All" || userUnit === targetUnit || tu.role === "admin") {
        await db.insert(notificationsTable).values({
          userId: tu.id, type: "production_unit_transfer",
          title: "Production Order Transferred",
          message: `Order ${invoice?.invoiceNumber || `#${orderId}`} transferred from ${previousUnit} to ${targetUnit} by ${user.name}. Reason: ${reason}`,
          link: `/production/orders/${orderId}`,
          relatedId: orderId, relatedType: "production_order",
        });
      }
    }
  }

  const [updated] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, orderId));
  return { order: await enrichProductionOrder(updated!) };
}

export async function getTransferHistory(orderId: number) {
  const history = await db
    .select({
      id: productionTransferHistoryTable.id,
      fromUnit: productionTransferHistoryTable.fromUnit,
      toUnit: productionTransferHistoryTable.toUnit,
      reason: productionTransferHistoryTable.reason,
      remarks: productionTransferHistoryTable.remarks,
      createdAt: productionTransferHistoryTable.createdAt,
      transferredByName: usersTable.name,
    })
    .from(productionTransferHistoryTable)
    .leftJoin(usersTable, eq(usersTable.id, productionTransferHistoryTable.transferredById))
    .where(eq(productionTransferHistoryTable.productionOrderId, orderId))
    .orderBy(desc(productionTransferHistoryTable.createdAt));

  return history;
}
