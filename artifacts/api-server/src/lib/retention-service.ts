import { db, contactsTable, dealsTable, notificationsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { createNotification } from "../routes/notifications";

const DAY_MS = 86_400_000;

// Alert a client when they cross 60 days without an order (i.e. 61+ days).
export const RETENTION_THRESHOLD_DAYS = 60;

const RETENTION_ALERT_TYPE = "retention_alert";

export interface RetentionDealLike {
  stage: string | null;
  completedAt?: Date | null;
  convertedAt?: Date | null;
  updatedAt?: Date | null;
}

// The client's "last order date" = the most recent Won deal's completion
// timestamp. `completedAt` is set the moment a deal becomes Won; `convertedAt`
// (My Client conversion) and `updatedAt` are fallbacks for legacy rows. `wonAt`
// is NOT used — no code path writes it (schema field only).
export function lastOrderDateOfDeals(deals: RetentionDealLike[]): Date | null {
  let latest: Date | null = null;
  for (const d of deals) {
    if (d.stage !== "Won") continue;
    const ts = d.completedAt ?? d.convertedAt ?? d.updatedAt ?? null;
    if (!ts) continue;
    if (!latest || ts.getTime() > latest.getTime()) latest = ts;
  }
  return latest;
}

// Whole-day difference between "now" and the last order date, using the SERVER's
// local date (same convention as dashboard.ts localDateStr). Order today = 0.
export function daysSinceLastOrderOfDeals(deals: RetentionDealLike[]): number | null {
  const lastOrder = lastOrderDateOfDeals(deals);
  if (!lastOrder) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(lastOrder);
  target.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - target.getTime()) / DAY_MS);
}

/**
 * Daily retention sweep: for every "My Client" contact (this covers the virtual
 * "Existing Client" view too) whose last Won deal is > 60 days old, notify the
 * sales owner — ONCE per cycle.
 *
 * Cycle dedup: an alert is skipped while a `retention_alert` notification for
 * that contact exists with `createdAt >= lastOrderDate`. A new Won order advances
 * `lastOrderDate`, so a later lapse alerts again. Read/unread state does NOT
 * matter — the goal is one nudge per lapse, not daily spam.
 */
export async function runRetentionAlertCheck(): Promise<{ checked: number; alerted: number; skipped: number }> {
  const contacts = await db.select().from(contactsTable).where(eq(contactsTable.category, "My Client"));
  if (contacts.length === 0) return { checked: 0, alerted: 0, skipped: 0 };

  const wonDeals = await db.select().from(dealsTable).where(eq(dealsTable.stage, "Won"));
  const dealsByContact = new Map<number, RetentionDealLike[]>();
  for (const d of wonDeals) {
    if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, []);
    dealsByContact.get(d.contactId)!.push(d);
  }

  let alerted = 0;
  let skipped = 0;

  for (const contact of contacts) {
    if (!contact.salesOwnerId) continue;
    const daysSince = daysSinceLastOrderOfDeals(dealsByContact.get(contact.id) ?? []);
    if (daysSince === null || daysSince <= RETENTION_THRESHOLD_DAYS) continue;

    const lastOrder = lastOrderDateOfDeals(dealsByContact.get(contact.id) ?? [])!;
    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, contact.salesOwnerId),
        eq(notificationsTable.type, RETENTION_ALERT_TYPE),
        eq(notificationsTable.relatedType, "contact"),
        eq(notificationsTable.relatedId, contact.id),
        gte(notificationsTable.createdAt, lastOrder),
      ))
      .limit(1);

    if (existing) {
      skipped += 1;
      continue;
    }

    await createNotification({
      userId: contact.salesOwnerId,
      createdById: null,
      type: RETENTION_ALERT_TYPE,
      title: "Retention Alert",
      message: `Retention Alert: ${contact.name} hasn't placed an order in over 60 days. Please take a follow-up.`,
      link: `/leads/${contact.id}`,
      relatedId: contact.id,
      relatedType: "contact",
    });
    alerted += 1;
  }

  return { checked: contacts.length, alerted, skipped };
}
