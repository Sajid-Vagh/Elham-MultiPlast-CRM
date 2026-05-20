import { Router, type IRouter } from "express";
import { db, activitiesTable, usersTable } from "@workspace/db";
import { eq, and, gte, SQL } from "drizzle-orm";
import { CreateActivityBody, UpdateActivityBody, ListActivitiesQueryParams, UpdateActivityParams, DeleteActivityParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichActivity(a: typeof activitiesTable.$inferSelect) {
  let user = null;
  if (a.createdBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, a.createdBy));
    if (u) { const { passwordHash: _, ...safe } = u; user = safe; }
  }
  return { ...a, user };
}

router.get("/activities", async (req, res) => {
  try {
    const params = ListActivitiesQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];
    if (params.success) {
      if (params.data.dealId) conditions.push(eq(activitiesTable.dealId, params.data.dealId));
      if (params.data.contactId) conditions.push(eq(activitiesTable.contactId, params.data.contactId));
      if (params.data.userId) conditions.push(eq(activitiesTable.createdBy, params.data.userId));
      if (params.data.upcoming) {
        const today = new Date().toISOString().split("T")[0]!;
        conditions.push(gte(activitiesTable.followUpDate, today));
      }
    }
    const activities = conditions.length
      ? await db.select().from(activitiesTable).where(and(...conditions)).orderBy(activitiesTable.createdAt)
      : await db.select().from(activitiesTable).orderBy(activitiesTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => { const { passwordHash: _, ...safe } = u; return [u.id, safe]; }));

    res.json(activities.map(a => ({ ...a, user: a.createdBy ? userMap.get(a.createdBy) ?? null : null })));
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
    await db.delete(activitiesTable).where(eq(activitiesTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
