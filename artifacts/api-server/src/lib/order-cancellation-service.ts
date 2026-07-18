/**
 * Order Cancellation Service
 *
 * Single source of truth for order cancellation business logic.
 * Handles permission validation, cascading updates, and audit trail.
 *
 * RULES:
 * - Cancellation Reason is mandatory
 * - Sales may cancel before production starts
 * - Production may cancel before Machine Running
 * - Production & Support may cancel with reason
 * - Admin can cancel anytime
 * - Completed orders cannot be cancelled (suggest Return Process)
 * - First order cancelled → move back to previous category
 * - Existing customer with completed orders → stay in My Client
 */

import {
  db, ordersTable, dealsTable, contactsTable, categoryHistoryTable,
  productionOrdersTable, usersTable, proformaInvoicesTable,
  existingCustomersTable, orderTimelineTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { CANCELLATION_REASONS } from "@workspace/db";
import type { PermissionUser } from "./permission-service";
import { logActivity, formatTimestamp } from "./activity-logger";
import { logAudit } from "../middlewares/auth";
import { createNotification } from "../routes/notifications";

/**
 * Valid production statuses that allow cancellation by production users.
 * "Machine Running" and beyond cannot be cancelled by production.
 */
const PRODUCTION_CANCELLABLE_STATUSES = [
  "Pending", "Accepted", "Planning",
];

/**
 * Cancellation permission matrix.
 * Returns null if allowed, or an error response if not.
 */
export function validateCancellationPermission(
  user: PermissionUser,
  order: any,
): { allowed: true } | { allowed: false; status: number; error: string } {
  const role = user.role;

  // Completed orders cannot be cancelled
  if (order.status === "Completed") {
    return { allowed: false, status: 400, error: "Completed orders cannot be cancelled. Please use the Return Process instead." };
  }

  // Already cancelled
  if (order.status === "Cancelled") {
    return { allowed: false, status: 400, error: "This order is already cancelled." };
  }

  // Admin can cancel anytime (except completed)
  if (role === "admin") return { allowed: true };

  // Production & Support can cancel with reason
  if (role === "production_and_support") return { allowed: true };

  // Sales can cancel before production starts
  if (role === "sales") {
    const cancellableStatuses = ["Draft", "Pending Verification", "Confirmed", "Production Pending"];
    if (!cancellableStatuses.includes(order.status)) {
      return { allowed: false, status: 403, error: "Sales can only cancel orders before production starts. Current status: " + order.status };
    }
    // Must own the order
    if (order.salesOwnerId !== user.id) {
      return { allowed: false, status: 403, error: "You can only cancel your own orders." };
    }
    return { allowed: true };
  }

  // Production can cancel before Machine Running
  if (role === "production") {
    if (!PRODUCTION_CANCELLABLE_STATUSES.includes(order.status)) {
      return { allowed: false, status: 403, error: "Production can only cancel orders before Machine Running. Current status: " + order.status };
    }
    return { allowed: true };
  }

  return { allowed: false, status: 403, error: "You do not have permission to cancel orders." };
}

/**
 * Validate cancellation reason.
 */
export function validateCancellationReason(
  reason: string,
  otherReason?: string,
): { valid: true } | { valid: false; status: number; error: string } {
  if (!reason) {
    return { valid: false, status: 400, error: "Cancellation reason is mandatory." };
  }
  if (!CANCELLATION_REASONS.includes(reason as any)) {
    return { valid: false, status: 400, error: `Invalid cancellation reason. Valid reasons: ${CANCELLATION_REASONS.join(", ")}` };
  }
  if (reason === "Other" && !otherReason?.trim()) {
    return { valid: false, status: 400, error: "Free text reason is required when selecting 'Other'." };
  }
  return { valid: true };
}

/**
 * Check if this contact has any completed orders (excluding the one being cancelled).
 * Used to determine Scenario A vs Scenario B.
 */
async function hasCompletedOrders(
  exec: typeof db,
  contactId: number,
  excludeOrderId: number,
): Promise<boolean> {
  const [result] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.contactId, contactId),
        eq(ordersTable.isDeleted, false),
        sql`${ordersTable.id} != ${excludeOrderId}`,
        sql`${ordersTable.status} IN ('Completed', 'Delivered')`,
      )
    );
  return (result?.count ?? 0) > 0;
}

/**
 * Core cancellation function.
 * Performs all cascading updates in sequence.
 */
export async function cancelOrder(
  user: PermissionUser,
  orderId: number,
  params: {
    reason: string;
    otherReason?: string;
    note?: string;
  },
): Promise<{ error?: string; status?: number; order?: any }> {
  const { reason, otherReason, note } = params;

  // 1. Fetch order
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return { error: "Order not found", status: 404 };

  // 2. Validate permission
  const permCheck = validateCancellationPermission(user, order);
  if (!permCheck.allowed) return { error: permCheck.error, status: permCheck.status };

  // 3. Validate reason
  const reasonCheck = validateCancellationReason(reason, otherReason);
  if (!reasonCheck.valid) return { error: reasonCheck.error, status: reasonCheck.status };

  const now = new Date();
  const previousStatus = order.status;

  // 4-9. Critical cascading updates inside a single transaction
  const transactionResult = await db.transaction(async (tx) => {
    // 4. Update order status to Cancelled
    await tx.update(ordersTable).set({
      status: "Cancelled",
      cancelledAt: now,
      cancelledBy: user.id,
      cancellationReason: reason,
      cancellationOtherReason: reason === "Other" ? otherReason : null,
      cancellationNote: note || null,
      updatedAt: now,
    }).where(eq(ordersTable.id, orderId));

    // 5. Order timeline entry
    await tx.insert(orderTimelineTable).values({
      orderId,
      type: "order_cancelled",
      description: `Order cancelled by ${user.name}. Reason: ${reason}${reason === "Other" ? ` (${otherReason})` : ""}${note ? `\nNote: ${note}` : ""}`,
      createdBy: user.id,
    });

    // 6. Cancel associated production order if exists
    const [productionOrder] = await tx.select().from(productionOrdersTable)
      .where(order.dealId ? eq(productionOrdersTable.dealId, order.dealId) : sql`false`)
      .limit(1);

    if (productionOrder && productionOrder.status !== "Completed") {
      await tx.update(productionOrdersTable).set({
        status: "Cancelled",
        updatedAt: now,
        updatedBy: user.id,
      }).where(eq(productionOrdersTable.id, productionOrder.id));
    }

    // 7. Update deal if Won → revert stage
    if (order.dealId) {
      const [deal] = await tx.select().from(dealsTable).where(eq(dealsTable.id, order.dealId));
      if (deal && deal.stage === "Won") {
        await tx.update(dealsTable).set({
          stage: "Lost",
          lostReason: `Order Cancelled — ${reason}`,
          otherReason: reason === "Other" ? otherReason : null,
          lostNotes: note || `Order #${order.orderNumber} was cancelled`,
          probability: 0,
          updatedAt: now,
        }).where(eq(dealsTable.id, order.dealId));
      }
    }

    // 8. Handle customer category (Scenario A vs B)
    if (order.contactId) {
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.contactId, order.contactId),
            eq(ordersTable.isDeleted, false),
            sql`${ordersTable.id} != ${orderId}`,
            sql`${ordersTable.status} IN ('Completed', 'Delivered')`,
          )
        );
      const hasOtherCompleted = (countResult?.count ?? 0) > 0;

      if (!hasOtherCompleted) {
        // Scenario A: First/only order cancelled → move back to previous category
        const [contact] = await tx.select().from(contactsTable).where(eq(contactsTable.id, order.contactId));
        if (contact && contact.isMyClient) {
          const [lastCategoryChange] = await tx.select().from(categoryHistoryTable)
            .where(
              and(
                eq(categoryHistoryTable.contactId, order.contactId),
                eq(categoryHistoryTable.newCategory, "My Client"),
              )
            )
            .orderBy(sql`${categoryHistoryTable.createdAt} DESC`)
            .limit(1);

          const revertCategory = lastCategoryChange?.previousCategory || "Regular Follow up";

          await tx.update(contactsTable).set({
            category: revertCategory,
            isMyClient: false,
          }).where(eq(contactsTable.id, order.contactId));

          await tx.insert(categoryHistoryTable).values({
            contactId: order.contactId,
            previousCategory: "My Client",
            newCategory: revertCategory,
            changedBy: user.id,
            reason: `Order #${order.orderNumber} cancelled — reverting from My Client to ${revertCategory}`,
          });

          // Remove from existing_customers if present
          await tx.update(existingCustomersTable).set({
            isActive: false,
            status: "Inactive",
          }).where(eq(existingCustomersTable.contactId, order.contactId));
        }
      }
      // Scenario B: Has other completed orders → stay in My Client (no action needed)
    }

    return { productionOrder };
  });

  // 9. Audit trail (outside transaction — uses global db)
  await logAudit(
    "order", orderId, "cancelled",
    { status: previousStatus },
    { status: "Cancelled", cancellationReason: reason, cancellationOtherReason: otherReason },
    user.id, undefined, user.role,
    `Reason: ${reason}${reason === "Other" ? ` (${otherReason})` : ""}`,
  );

  // 10. Activity log entry
  await logActivity(db, {
    dealId: order.dealId || null,
    contactId: order.contactId || null,
    type: "Note",
    notes: `Deal moved from Won to Lost due to order cancellation.\n\nReason: ${reason}${reason === "Other" ? ` (${otherReason})` : ""}\nOrder: ${order.orderNumber}\n\nBy: ${user.name}\n${formatTimestamp(now)}`,
    createdBy: user.id,
  });

  // 11. Notifications
  const notifyUsers = new Set<number>();
  if (order.salesOwnerId && order.salesOwnerId !== user.id) notifyUsers.add(order.salesOwnerId);
  if (order.supportOwnerId && order.supportOwnerId !== user.id) notifyUsers.add(order.supportOwnerId);
  if (order.productionOwnerId && order.productionOwnerId !== user.id) notifyUsers.add(order.productionOwnerId);

  const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    if (admin.id !== user.id) notifyUsers.add(admin.id);
  }

  for (const uid of notifyUsers) {
    await createNotification({
      userId: uid,
      type: "order_cancelled",
      title: "Order Cancelled",
      message: `Order ${order.orderNumber} has been cancelled.\nReason: ${reason}${reason === "Other" ? ` (${otherReason})` : ""}\nCustomer: ${order.customerName}\nCancelled by: ${user.name}`,
      link: `/orders/${orderId}`,
      relatedId: orderId,
      relatedType: "order",
    });
  }

  // 12. Re-fetch and return updated order
  const [updated] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return { order: updated };
}
