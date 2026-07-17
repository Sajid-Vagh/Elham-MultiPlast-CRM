import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { createNotification } from "../routes/notifications";

/**
 * Parameters for production team notifications.
 */
export interface ProductionNotificationParams {
  /** The production unit for this order */
  productionUnit: string;
  /** Title of the notification */
  title: string;
  /** Message body */
  message: string;
  /** Link path (e.g., "/production/orders/123") */
  link: string;
  /** Related entity ID */
  relatedId: number;
  /** Related entity type */
  relatedType: string;
  /** Notification type */
  type: string;
  /** User ID to exclude from notifications (usually the action taker) */
  excludeUserId?: number;
}

/**
 * Notify production users based on unit permissions.
 *
 * Rules (single source of truth):
 * - admin role: sees ALL units
 * - user.unit === "All": sees ALL units
 * - Himatnagar users: see ALL units (including Surat/Rajkot)
 * - Surat users: see only Surat
 * - Rajkot users: see only Rajkot
 *
 * This function is called by:
 * - mark-won (deal won → production order)
 * - PI conversion (PI → production order)
 * - PI update sync (early-stage auto-sync)
 * - PI update (completed/in-progress warnings)
 */
export async function notifyProductionUsers(params: ProductionNotificationParams) {
  const {
    productionUnit,
    title,
    message,
    link,
    relatedId,
    relatedType,
    type,
    excludeUserId,
  } = params;

  const prodUsers = await db
    .select({ id: usersTable.id, unit: usersTable.unit, role: usersTable.role, name: usersTable.name })
    .from(usersTable)
    .where(or(
      eq(usersTable.role, "production"),
      eq(usersTable.role, "production_and_support"),
      eq(usersTable.role, "admin"),
    ));

  const orderUnit = productionUnit || "Himatnagar";

  for (const pu of prodUsers) {
    if (pu.id === excludeUserId) continue;

    const userUnit = pu.unit || "All";
    const shouldNotify =
      pu.role === "admin" ||
      userUnit === "All" ||
      userUnit === orderUnit ||
      orderUnit === "Himatnagar";

    if (!shouldNotify) continue;

    await createNotification({
      userId: pu.id,
      type,
      title,
      message,
      link,
      relatedId,
      relatedType,
    });
  }
}

/**
 * Notify sales owner and admins about a deal event.
 */
export async function notifyDealEvent(params: {
  dealId: number;
  dealTitle: string;
  contactName: string;
  salesOwnerId: number | null;
  actionUserId: string;
  type: string;
  title: string;
  message: string;
  link: string;
  relatedType: string;
}) {
  const { dealId, dealTitle, contactName, salesOwnerId, actionUserId, type, title, message, link, relatedType } = params;

  // Notify sales owner
  const notifyUserId = salesOwnerId || Number(actionUserId);
  if (notifyUserId && String(notifyUserId) !== actionUserId) {
    await createNotification({
      userId: notifyUserId,
      type,
      title,
      message,
      link,
      relatedId: dealId,
      relatedType,
    });
  }

  // Notify admins
  const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    if (String(admin.id) !== actionUserId && admin.id !== notifyUserId) {
      await createNotification({
        userId: admin.id,
        type,
        title: title.replace("! 🎉", ""),
        message: `Deal "${dealTitle || `#${dealId}`}" won for ${contactName || "Unknown"}\n${message.split("\n").slice(1).join("\n")}`,
        link,
        relatedId: dealId,
        relatedType,
      });
    }
  }
}
