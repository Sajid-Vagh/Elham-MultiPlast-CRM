import { Router, type IRouter } from "express";
import { db, activitiesTable, usersTable, contactsTable, dealsTable, notificationsTable } from "@workspace/db";
import { eq, and, gte, isNull, SQL } from "drizzle-orm";
import { CreateActivityBody, UpdateActivityBody, ListActivitiesQueryParams, UpdateActivityParams, DeleteActivityParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { getAccessibleUnits } from "../lib/unit-filter";

const router: IRouter = Router();

type NoteEntry = {
  text: string;
  date: string;
  time: string;
  userName: string;
  userId: number;
};

function isJsonNotes(n: string | null | undefined): boolean {
  if (!n) return false;
  const t = n.trim();
  if (!t.startsWith("[")) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

function parseNotes(notes: string | null | undefined): NoteEntry[] {
  if (!notes) return [];
  if (isJsonNotes(notes)) {
    try { return JSON.parse(notes!) as NoteEntry[]; } catch { return []; }
  }
  // Legacy plain text: convert to single entry
  return [{ text: notes, date: "", time: "", userName: "", userId: 0 }];
}

function notesToDisplay(notes: string | null | undefined): string {
  const entries = parseNotes(notes);
  if (entries.length === 0) return "";
  if (entries.length === 1 && !entries[0]!.date) return entries[0]!.text;
  return [...entries].reverse().map(e => {
    const prefix = e.date ? `${e.date}${e.time ? ` ${e.time}` : ""}${e.userName ? ` - ${e.userName}` : ""}` : "";
    return prefix ? `${prefix}\n${e.text}` : e.text;
  }).join("\n\n---\n\n");
}

function appendNotesHistory(
  existingNotes: string | null | undefined,
  newNotes: string | null | undefined,
  user: { id: number; name: string }
): string {
  const entries = parseNotes(existingNotes);
  if (newNotes) {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    entries.push({
      text: newNotes,
      date: dateStr,
      time: timeStr,
      userName: user.name,
      userId: user.id,
    });
  }
  return JSON.stringify(entries);
}

async function createAuditEntry(
  dealId: number,
  contactId: number | null | undefined,
  description: string,
  userId: number
) {
  await db.insert(activitiesTable).values({
    dealId,
    contactId: contactId ?? null,
    type: "Note",
    notes: description,
    createdBy: userId,
  });
}

async function enrichActivity(a: typeof activitiesTable.$inferSelect) {
  let user = null;
  if (a.createdBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, a.createdBy));
    if (u) { const { passwordHash: _, ...safe } = u; user = safe; }
  }
  let deal = null;
  if (a.dealId) {
    const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, a.dealId));
    if (d) deal = d;
  }
  let contact = null;
  if (a.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, a.contactId));
    if (c) contact = c;
  } else if (deal?.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
    if (c) contact = c;
  }
  return { ...a, notesDisplay: notesToDisplay(a.notes), user, deal, contact };
}

router.get("/activities", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const params = ListActivitiesQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];

    if (user.role === "sales") {
      conditions.push(eq(activitiesTable.createdBy, user.id));
    }

    if (params.success) {
      if (params.data.dealId) conditions.push(eq(activitiesTable.dealId, params.data.dealId));
      if (params.data.contactId) conditions.push(eq(activitiesTable.contactId, params.data.contactId));
      if (params.data.userId) conditions.push(eq(activitiesTable.createdBy, params.data.userId));
    }

    // Handle upcoming + date filters with proper support for extra query params
    const dateFilter = req.query.date as string | undefined;
    const callStatusFilter = req.query.callStatus as string | undefined;
    const categoryFilter = req.query.category as string | undefined;
    const upcoming = req.query.upcoming === "true";

    if (dateFilter) {
      conditions.push(eq(activitiesTable.followUpDate, dateFilter));
    }

    if (callStatusFilter) {
      conditions.push(eq(activitiesTable.callStatus, callStatusFilter));
    }

    // For upcoming, we filter by followUpDate >= today + post-filter for category and status
    if (upcoming && !dateFilter) {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      conditions.push(gte(activitiesTable.followUpDate, today));
    }

    const activities = conditions.length
      ? await db.select().from(activitiesTable).where(and(...conditions)).orderBy(activitiesTable.createdAt)
      : await db.select().from(activitiesTable).orderBy(activitiesTable.createdAt);

    const contacts = await db.select().from(contactsTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    const deals = await db.select().from(dealsTable);
    const dealMap = new Map(deals.map(d => [d.id, d]));

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => { const { passwordHash: _, ...safe } = u; return [u.id, safe]; }));

    // Enrich with contact data and display-ready notes
    let enriched = activities.map(a => {
      let contact = a.contactId ? contactMap.get(a.contactId) ?? null : null;
      if (!contact && a.dealId) {
        const deal = dealMap.get(a.dealId);
        if (deal) contact = contactMap.get(deal.contactId) ?? null;
      }
      return {
        ...a,
        notesDisplay: notesToDisplay(a.notes),
        user: a.createdBy ? userMap.get(a.createdBy) ?? null : null,
        deal: a.dealId ? dealMap.get(a.dealId) ?? null : null,
        contact,
      };
    });

    // Unit isolation: filter activities by user's accessible units
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      enriched = enriched.filter(a => {
        const unit = a.contact?.unit;
        return !unit || accessibleUnits.includes(unit);
      });
    }

    // Post-filter for upcoming: only Pending status (any category)
    if (upcoming && !dateFilter) {
      enriched = enriched.filter(a => a.callStatus === "Pending");
    }

    // Post-filter for category
    if (categoryFilter) {
      enriched = enriched.filter(a => {
        const cat = a.contact?.category;
        return cat === categoryFilter;
      });
    }

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "List activities error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/activities", async (req, res) => {
  const parsed = CreateActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

    let activity: typeof activitiesTable.$inferSelect | undefined;

    // Upsert: ensure only one FollowUp per deal
    if (parsed.data.type === "FollowUp" && parsed.data.dealId) {
      const [existing] = await db.select()
        .from(activitiesTable)
        .where(
          and(
            eq(activitiesTable.dealId, parsed.data.dealId),
            eq(activitiesTable.type, "FollowUp")
          )
        );
      if (existing) {
        // Build update data with notes history
        const updateData: Record<string, any> = {
          ...parsed.data,
          updatedAt: new Date(),
          updatedBy: currentUser.id,
          isEdited: true,
        };

        // Append notes to history instead of replacing
        if (parsed.data.notes !== undefined) {
          updateData.notes = appendNotesHistory(existing.notes, parsed.data.notes, currentUser);
        } else {
          updateData.notes = existing.notes;
        }

        const [updated] = await db.update(activitiesTable)
          .set(updateData)
          .where(eq(activitiesTable.id, existing.id))
          .returning();
        activity = updated;

        // Create audit entries for changes
        if (parsed.data.followUpDate !== undefined && parsed.data.followUpDate !== existing.followUpDate) {
          const oldDate = existing.followUpDate || "(none)";
          const newDate = parsed.data.followUpDate || "(none)";
          const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          await createAuditEntry(
            updated!.dealId,
            updated!.contactId,
            `${currentUser.name} changed Follow-up Date\n${oldDate} → ${newDate}\n\n${now}`,
            currentUser.id
          );
        }

        if (parsed.data.callStatus !== undefined && parsed.data.callStatus !== existing.callStatus) {
          const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          await createAuditEntry(
            updated!.dealId,
            updated!.contactId,
            `${currentUser.name} changed Status\n${existing.callStatus || "Pending"} → ${parsed.data.callStatus}\n\n${now}`,
            currentUser.id
          );
        }

        if (parsed.data.followUpTime !== undefined && parsed.data.followUpTime !== existing.followUpTime) {
          const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          await createAuditEntry(
            updated!.dealId,
            updated!.contactId,
            `${currentUser.name} changed Follow-up Time\n${existing.followUpTime || "(none)"} → ${parsed.data.followUpTime || "(none)"}\n\n${now}`,
            currentUser.id
          );
        }

        // Mark old notification as seen when follow-up is updated
        await db
          .update(notificationsTable)
          .set({ notificationSeen: true, notificationSeenAt: new Date() })
          .where(and(
            eq(notificationsTable.relatedId, existing.id),
            eq(notificationsTable.relatedType, "activity"),
            eq(notificationsTable.type, "follow_up"),
            eq(notificationsTable.notificationSeen, false),
          ));
      }
    }

    // If no upsert happened, insert new record
    if (!activity) {
      const notesValue = (parsed.data.type === "FollowUp" && parsed.data.notes)
        ? JSON.stringify([{
            text: parsed.data.notes,
            date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
            userName: currentUser.name,
            userId: currentUser.id,
          }])
        : parsed.data.notes ?? null;

      const [inserted] = await db.insert(activitiesTable).values({
        dealId: parsed.data.dealId,
        contactId: parsed.data.contactId ?? null,
        type: parsed.data.type,
        notes: notesValue,
        followUpDate: parsed.data.followUpDate ?? null,
        followUpTime: parsed.data.followUpTime ?? null,
        followUpType: parsed.data.followUpType ?? null,
        callStatus: parsed.data.callStatus ?? "Pending",
        priority: parsed.data.priority ?? "Medium",
        reminder: parsed.data.reminder ?? null,
        assignedTo: parsed.data.assignedTo ?? null,
        createdBy: currentUser.id,
      }).returning();
      activity = inserted;
      // Create audit entry for new FollowUp
      if (parsed.data.type === "FollowUp") {
        const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        await createAuditEntry(
          inserted!.dealId,
          inserted!.contactId,
          `${currentUser.name} created Follow-up\nDate: ${inserted!.followUpDate || "(not set)"}${inserted!.followUpTime ? ` Time: ${inserted!.followUpTime}` : ""}\n\n${now}`,
          currentUser.id
        );
      }
    }

    // Notify contact's sales owner about new follow-up
    if (activity && (activity.contactId || activity.dealId)) {
      let contactOwnerId: number | null = null;
      let contactCategory: string | null = null;
      if (activity.contactId) {
        const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId, category: contactsTable.category }).from(contactsTable).where(eq(contactsTable.id, activity.contactId));
        if (contact?.salesOwnerId) contactOwnerId = contact.salesOwnerId;
        if (contact?.category) contactCategory = contact.category;
      } else if (activity.dealId) {
        const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, activity.dealId));
        if (deal) {
          const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId, category: contactsTable.category }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
          if (contact?.salesOwnerId) contactOwnerId = contact.salesOwnerId;
          if (contact?.category) contactCategory = contact.category;
        }
      }
      // Only create notification for Regular Follow up leads or if follow-up date is set
      if (contactOwnerId && activity.followUpDate) {
        if (contactCategory === "Regular Follow up" || parsed.data.type !== "FollowUp") {
          const displayNotes = notesToDisplay(activity.notes).slice(0, 150);
          await createNotification({
            userId: contactOwnerId,
            type: "follow_up",
            title: "Follow-up Scheduled",
            message: activity.followUpDate
              ? `Follow-up on ${activity.followUpDate}${activity.followUpTime ? ` at ${activity.followUpTime}` : ""}\nType: ${activity.type}${displayNotes ? `\nNotes: ${displayNotes}` : ""}\nBy: ${currentUser.name || "System"}`
              : `New ${activity.type} activity recorded`,
            link: activity.dealId ? `/deals/${activity.dealId}` : activity.contactId ? `/leads/${activity.contactId}` : "#",
            relatedId: activity.id,
            relatedType: "activity",
          });
        }
      }
    }

    const enriched = await enrichActivity(activity!);
    res.status(201).json(enriched);
  } catch (err) {
    req.log.error({ err }, "Create activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/activities/:id", async (req, res) => {
  const params = UpdateActivityParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateActivityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role === "sales") {
      const [existing] = await db.select({ createdBy: activitiesTable.createdBy }).from(activitiesTable).where(eq(activitiesTable.id, params.data.id));
      if (!existing || existing.createdBy !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    const [existingActivity] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, params.data.id));
    if (!existingActivity) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: Record<string, any> = {
      ...parsed.data,
      updatedAt: new Date(),
      updatedBy: user.id,
      isEdited: true,
    };

    // Append notes to history instead of replacing
    if (parsed.data.notes !== undefined) {
      updateData.notes = appendNotesHistory(existingActivity.notes, parsed.data.notes, user);
    } else {
      updateData.notes = existingActivity.notes;
    }

    // Create audit entries for changes
    if (parsed.data.followUpDate !== undefined && parsed.data.followUpDate !== existingActivity.followUpDate) {
      const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      await createAuditEntry(
        existingActivity.dealId,
        existingActivity.contactId,
        `${user.name} changed Follow-up Date\n${existingActivity.followUpDate || "(none)"} → ${parsed.data.followUpDate || "(none)"}\n\n${now}`,
        user.id
      );
    }

    if (parsed.data.callStatus !== undefined && parsed.data.callStatus !== existingActivity.callStatus) {
      const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      await createAuditEntry(
        existingActivity.dealId,
        existingActivity.contactId,
        `${user.name} changed Status\n${existingActivity.callStatus || "Pending"} → ${parsed.data.callStatus}\n\n${now}`,
        user.id
      );
    }

    if (parsed.data.followUpTime !== undefined && parsed.data.followUpTime !== existingActivity.followUpTime) {
      const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      await createAuditEntry(
        existingActivity.dealId,
        existingActivity.contactId,
        `${user.name} changed Follow-up Time\n${existingActivity.followUpTime || "(none)"} → ${parsed.data.followUpTime || "(none)"}\n\n${now}`,
        user.id
      );
    }

    // Dismiss notifications for any non-Pending status change
    if (parsed.data.callStatus !== undefined && parsed.data.callStatus !== "Pending") {
      const notifUpdate: Record<string, any> = { notificationSeen: true, notificationSeenAt: new Date() };
      if (parsed.data.callStatus === "Completed") {
        notifUpdate.readAt = new Date();
      }
      await db
        .update(notificationsTable)
        .set(notifUpdate)
        .where(and(
          eq(notificationsTable.relatedId, params.data.id),
          eq(notificationsTable.relatedType, "activity"),
          isNull(notificationsTable.readAt),
        ));

      // Create notification when follow-up is completed
      if (parsed.data.callStatus === "Completed") {
        let contactOwnerId: number | null = null;
        let contactName = "Unknown";
        if (existingActivity.contactId) {
          const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId, name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, existingActivity.contactId));
          if (contact) { contactOwnerId = contact.salesOwnerId; contactName = contact.name; }
        } else if (existingActivity.dealId) {
          const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, existingActivity.dealId));
          if (deal) {
            const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId, name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
            if (contact) { contactOwnerId = contact.salesOwnerId; contactName = contact.name; }
          }
        }
        if (contactOwnerId && contactOwnerId !== user.id) {
          await createNotification({
            userId: contactOwnerId,
            type: "follow_up_completed",
            title: "Follow-up Completed",
            message: `Follow-up for ${contactName} has been marked as Completed.\nCompleted By: ${user.name}`,
            link: existingActivity.contactId ? `/leads/${existingActivity.contactId}` : existingActivity.dealId ? `/deals/${existingActivity.dealId}` : "#",
            relatedId: params.data.id,
            relatedType: "activity",
          });
        }
      }
    }

    const [activity] = await db.update(activitiesTable).set(updateData).where(eq(activitiesTable.id, params.data.id)).returning();
    if (!activity) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichActivity(activity));
  } catch (err) {
    req.log.error({ err }, "Update activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/activities/:id", async (req, res) => {
  const params = DeleteActivityParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role === "sales") {
      const [existing] = await db.select({ createdBy: activitiesTable.createdBy }).from(activitiesTable).where(eq(activitiesTable.id, params.data.id));
      if (!existing || existing.createdBy !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    await db.delete(activitiesTable).where(eq(activitiesTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
