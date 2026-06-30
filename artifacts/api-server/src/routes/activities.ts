import { Router, type IRouter } from "express";
import { db, activitiesTable, usersTable, contactsTable, dealsTable, notificationsTable, CATEGORIES } from "@workspace/db";
import { eq, and, gte, lte, isNull, SQL, inArray } from "drizzle-orm";
import { CreateActivityBody, UpdateActivityBody, ListActivitiesQueryParams, UpdateActivityParams, DeleteActivityParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

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
  return { ...a, user, deal, contact };
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

    // Enrich with contact data
    let enriched = activities.map(a => {
      let contact = a.contactId ? contactMap.get(a.contactId) ?? null : null;
      if (!contact && a.dealId) {
        const deal = dealMap.get(a.dealId);
        if (deal) contact = contactMap.get(deal.contactId) ?? null;
      }
      return {
        ...a,
        user: a.createdBy ? userMap.get(a.createdBy) ?? null : null,
        deal: a.dealId ? dealMap.get(a.dealId) ?? null : null,
        contact,
      };
    });

    // Post-filter for upcoming: only Regular Follow up + not Completed
    if (upcoming && !dateFilter) {
      enriched = enriched.filter(a => {
        if (a.callStatus === "Completed") return false;
        const cat = a.contact?.category;
        if (cat !== "Regular Follow up") return false;
        return true;
      });
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
        const [updated] = await db.update(activitiesTable)
          .set({
            ...parsed.data,
            updatedAt: new Date(),
            updatedBy: currentUser.id,
            isEdited: true,
          })
          .where(eq(activitiesTable.id, existing.id))
          .returning();
        activity = updated;
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
      const [inserted] = await db.insert(activitiesTable).values({
        ...parsed.data,
        createdBy: currentUser.id,
      }).returning();
      activity = inserted;
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
          await createNotification({
            userId: contactOwnerId,
            type: "follow_up",
            title: "Follow-up Scheduled",
            message: activity.followUpDate
              ? `Follow-up on ${activity.followUpDate}${activity.followUpTime ? ` at ${activity.followUpTime}` : ""}\nType: ${activity.type}${activity.notes ? `\nNotes: ${activity.notes.slice(0, 100)}` : ""}\nBy: ${currentUser.name || "System"}`
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
    const updateData = {
      ...parsed.data,
      updatedAt: new Date(),
      updatedBy: user.id,
      isEdited: true,
    };

    // If marking as Completed, mark related notifications as read
    if (parsed.data.callStatus === "Completed") {
      await db
        .update(notificationsTable)
        .set({ readAt: new Date() })
        .where(and(
          eq(notificationsTable.relatedId, params.data.id),
          eq(notificationsTable.relatedType, "activity"),
          isNull(notificationsTable.readAt),
        ));
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
