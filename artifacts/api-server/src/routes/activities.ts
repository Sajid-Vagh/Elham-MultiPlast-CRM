import { Router, type IRouter } from "express";
import { db, activitiesTable, usersTable, contactsTable, dealsTable } from "@workspace/db";
import { eq, and, gte, lte, SQL } from "drizzle-orm";
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
      if (params.data.upcoming) {
        const today = new Date().toISOString().split("T")[0]!;
        conditions.push(gte(activitiesTable.followUpDate, today));
      }
      if (params.data.date) {
        conditions.push(eq(activitiesTable.followUpDate, params.data.date));
      }
    }
    const activities = conditions.length
      ? await db.select().from(activitiesTable).where(and(...conditions)).orderBy(activitiesTable.createdAt)
      : await db.select().from(activitiesTable).orderBy(activitiesTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => { const { passwordHash: _, ...safe } = u; return [u.id, safe]; }));

    const deals = await db.select().from(dealsTable);
    const dealMap = new Map(deals.map(d => [d.id, d]));

    const contacts = await db.select().from(contactsTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    res.json(activities.map(a => ({
      ...a,
      user: a.createdBy ? userMap.get(a.createdBy) ?? null : null,
      deal: dealMap.get(a.dealId) ?? null,
      contact: a.contactId ? contactMap.get(a.contactId) ?? null : (dealMap.get(a.dealId)?.contactId ? contactMap.get(dealMap.get(a.dealId)!.contactId) ?? null : null),
    })));
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
    const [activity] = await db.insert(activitiesTable).values(parsed.data).returning();

    // Notify contact's sales owner about new follow-up
    if (activity && (activity.contactId || activity.dealId)) {
      let contactOwnerId: number | null = null;
      if (activity.contactId) {
        const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, activity.contactId));
        if (contact?.salesOwnerId) contactOwnerId = contact.salesOwnerId;
      } else if (activity.dealId) {
        const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, activity.dealId));
        if (deal) {
          const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
          if (contact?.salesOwnerId) contactOwnerId = contact.salesOwnerId;
        }
      }
      if (contactOwnerId) {
        const adminUser = await getUserFromRequest(req);
        await createNotification({
          userId: contactOwnerId,
          type: "follow_up",
          title: "Follow-up Scheduled",
          message: activity.followUpDate
            ? `Follow-up on ${activity.followUpDate}${activity.followUpTime ? ` at ${activity.followUpTime}` : ""}\nType: ${activity.type}${activity.notes ? `\nNotes: ${activity.notes.slice(0, 100)}` : ""}\nBy: ${adminUser?.name || "System"}`
            : `New ${activity.type} activity recorded`,
          link: activity.dealId ? `/deals/${activity.dealId}` : activity.contactId ? `/leads/${activity.contactId}` : "#",
          relatedId: activity.id,
          relatedType: "activity",
        });
      }
    }

    res.status(201).json(await enrichActivity(activity!));
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
    const [activity] = await db.update(activitiesTable).set(parsed.data).where(eq(activitiesTable.id, params.data.id)).returning();
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
