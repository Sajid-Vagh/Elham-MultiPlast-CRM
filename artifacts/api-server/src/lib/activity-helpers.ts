import { activitiesTable, notificationsTable } from "@workspace/db";
import { eq, and, or, inArray, isNull } from "drizzle-orm";

/**
 * Automatically complete all pending activities for a given deal.
 * Called when a deal reaches a final state (Won or Lost).
 *
 * - Sets callStatus → "Completed" on all Pending/NULL activities for the deal
 * - Marks related notifications as read
 * - Creates an audit Note entry in the activity log
 */
export async function completePendingActivitiesForDeal(
  exec: { select: Function; update: Function; insert: Function },
  dealId: number,
  contactId: number | null,
  stage: "Won" | "Lost",
  userId: number
) {
  // 1. Find all pending activities for this deal
  const pendingActivities = await exec
    .select({ id: activitiesTable.id })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.dealId, dealId),
        or(
          eq(activitiesTable.callStatus, "Pending"),
          isNull(activitiesTable.callStatus)
        )
      )
    );

  if (pendingActivities.length === 0) return;

  const activityIds = pendingActivities.map((a: any) => a.id);

  // 2. Mark them as Completed
  await exec
    .update(activitiesTable)
    .set({
      callStatus: "Completed",
      updatedAt: new Date(),
      updatedBy: userId,
      isEdited: true,
    })
    .where(inArray(activitiesTable.id, activityIds));

  // 3. Dismiss related notifications (mark as read)
  await exec
    .update(notificationsTable)
    .set({
      notificationSeen: true,
      notificationSeenAt: new Date(),
      readAt: new Date(),
    })
    .where(
      and(
        inArray(notificationsTable.relatedId, activityIds),
        eq(notificationsTable.relatedType, "activity"),
        isNull(notificationsTable.readAt)
      )
    );

  // 4. Create audit log entry
  const ts = new Date().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  await exec.insert(activitiesTable).values({
    dealId,
    contactId: contactId ?? null,
    type: "Note",
    notes: `Pending Activities (${activityIds.length}) automatically completed because Deal was marked as ${stage}.\n\n${ts}`,
    createdBy: userId,
  });
}
