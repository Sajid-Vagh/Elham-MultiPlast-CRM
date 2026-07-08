import { Router, type IRouter } from "express";
import { db, contactsTable, dealsTable, usersTable, categoryHistoryTable, activitiesTable, notificationsTable, productsTable, dealProductsTable, CATEGORIES } from "@workspace/db";
import { eq, and, or, inArray, isNull, SQL, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

router.get("/categories/counts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";
    const unit = req.query.unit as string | undefined;

    let conditions: SQL[] = [];
    if (!isAdmin) {
      conditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (unit) {
      conditions.push(eq(contactsTable.unit, unit));
    }

    const counts = [];
    for (const category of CATEGORIES) {
      const catConditions = [eq(contactsTable.category, category), ...conditions];
      const [result] = await db
        .select({ count: sql`count(*)::int` })
        .from(contactsTable)
        .where(and(...catConditions));
      counts.push({ category, count: result?.count ?? 0 });
    }

    res.json(counts);
  } catch (err) {
    req.log.error({ err }, "Get category counts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/categories/:category/contacts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";
    const { category } = req.params;
    const unit = req.query.unit as string | undefined;

    if (!CATEGORIES.includes(category as any)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }

    const conditions: SQL[] = [eq(contactsTable.category, category)];
    if (!isAdmin) {
      conditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (unit) {
      conditions.push(eq(contactsTable.unit, unit));
    }

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(and(...conditions))
      .orderBy(contactsTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    const deals = await db.select().from(dealsTable);
    const dealsByContact = new Map<number, typeof deals>();
    for (const d of deals) {
      if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, []);
      dealsByContact.get(d.contactId)!.push(d);
    }

    const contactIds = contacts.map(c => c.id);
    let activities: (typeof activitiesTable.$inferSelect)[] = [];
    if (contactIds.length > 0) {
      activities = await db
        .select()
        .from(activitiesTable)
        .where(inArray(activitiesTable.contactId, contactIds));
    }
    const activitiesByContact = new Map<number, typeof activities>();
    for (const a of activities) {
      if (!a.contactId) continue;
      if (!activitiesByContact.has(a.contactId)) activitiesByContact.set(a.contactId, []);
      activitiesByContact.get(a.contactId)!.push(a);
    }

    const dealIds = deals.map(d => d.id);
    let dealProducts: (typeof dealProductsTable.$inferSelect)[] = [];
    if (dealIds.length > 0) {
      dealProducts = await db
        .select()
        .from(dealProductsTable)
        .where(inArray(dealProductsTable.dealId, dealIds));
    }
    const productIds = [...new Set(dealProducts.map(dp => dp.productId))];
    let products: (typeof productsTable.$inferSelect)[] = [];
    if (productIds.length > 0) {
      products = await db
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
    }
    const productMap = new Map(products.map(p => [p.id, p]));
    const dealProductsByDeal = new Map<number, typeof dealProducts>();
    for (const dp of dealProducts) {
      if (!dealProductsByDeal.has(dp.dealId)) dealProductsByDeal.set(dp.dealId, []);
      dealProductsByDeal.get(dp.dealId)!.push(dp);
    }

    res.json(contacts.map(c => ({
      ...c,
      salesOwner: userMap.get(c.salesOwnerId) ?? null,
      deals: (dealsByContact.get(c.id) ?? []).map(d => ({
        ...d,
        products: (dealProductsByDeal.get(d.id) ?? []).map(dp => ({
          ...dp,
          product: productMap.get(dp.productId) ?? null
        }))
      })),
      activities: activitiesByContact.get(c.id) ?? []
    })));
  } catch (err) {
    req.log.error({ err }, "Get category contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/categories/:category/contacts/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";
    const { category } = req.params;
    const { q, ownerId, city, industry, unit } = req.query as Record<string, string | undefined>;

    if (!CATEGORIES.includes(category as any)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }

    const conditions: SQL[] = [eq(contactsTable.category, category)];
    if (!isAdmin) {
      conditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (unit) {
      conditions.push(eq(contactsTable.unit, unit));
    }
    if (q) {
      const s = `%${q}%`;
      conditions.push(
        sql`(${contactsTable.name} ILIKE ${s} OR ${contactsTable.mobile} ILIKE ${s} OR ${contactsTable.companyName} ILIKE ${s} OR ${contactsTable.city} ILIKE ${s})`
      );
    }
    if (ownerId) conditions.push(eq(contactsTable.salesOwnerId, Number(ownerId)));
    if (city) conditions.push(sql`${contactsTable.city} ILIKE ${`%${city}%`}`);
    if (industry) conditions.push(eq(contactsTable.industry, industry));

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(and(...conditions))
      .orderBy(contactsTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    const deals = await db.select().from(dealsTable);
    const dealsByContact = new Map<number, typeof deals>();
    for (const d of deals) {
      if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, []);
      dealsByContact.get(d.contactId)!.push(d);
    }

    res.json(contacts.map(c => ({
      ...c,
      salesOwner: userMap.get(c.salesOwnerId) ?? null,
      deals: dealsByContact.get(c.id) ?? []
    })));
  } catch (err) {
    req.log.error({ err }, "Search category contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/categories/move", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { contactIds, newCategory, reason } = req.body as {
      contactIds: number[];
      newCategory: string;
      reason?: string;
    };

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: "contactIds must be a non-empty array" });
      return;
    }
    if (!CATEGORIES.includes(newCategory as any)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }
    // Block bulk move to "My Client" (only via deal WON flow)
    if (newCategory === "My Client") {
      res.status(400).json({ error: "Cannot move contacts to My Client via bulk operation. A deal must be Won first." });
      return;
    }

    const isAdmin = user.role === "admin";
    const history: any[] = [];
    const movedContactIds: number[] = [];

    for (const contactId of contactIds) {
      const [contact] = await db
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.id, contactId));

      if (!contact) continue;
      if (!isAdmin && contact.salesOwnerId !== user.id) continue;

      // EXCEPTION: Permanent My Clients (isMyClient=true) ALWAYS stay in My Clients
      if (contact.isMyClient) continue;

      const prevCategory = contact.category;

      await db
        .update(contactsTable)
        .set({ category: newCategory })
        .where(eq(contactsTable.id, contactId));

      const [h] = await db
        .insert(categoryHistoryTable)
        .values({
          contactId,
          previousCategory: prevCategory,
          newCategory,
          changedBy: user.id,
          reason: reason ?? null,
        })
        .returning();

      if (h) {
        history.push(h);
        movedContactIds.push(contactId);
      }
    }

    // If moving away from "Regular Follow up" to other categories, complete pending follow-ups and close deals
    if (newCategory !== "Regular Follow up" && movedContactIds.length > 0) {
      // Auto-close related deals as Lost
      const contactDeals = await db
        .select({ id: dealsTable.id, stage: dealsTable.stage })
        .from(dealsTable)
        .where(and(
          inArray(dealsTable.contactId, movedContactIds),
          eq(dealsTable.stage, "New"),
        ));
      if (contactDeals.length > 0) {
        await db
          .update(dealsTable)
          .set({ stage: "Lost", lostReason: "Lead moved out of pipeline category", updatedAt: new Date() })
          .where(inArray(dealsTable.id, contactDeals.map(d => d.id)));
      }

      const pendingFollowUps = await db
        .select({ id: activitiesTable.id, dealId: activitiesTable.dealId })
        .from(activitiesTable)
        .where(
          and(
            eq(activitiesTable.type, "FollowUp"),
            inArray(activitiesTable.contactId, movedContactIds),
            or(eq(activitiesTable.callStatus, "Pending"), isNull(activitiesTable.callStatus)),
          )
        );

      if (pendingFollowUps.length > 0) {
        const followUpIds = pendingFollowUps.map(f => f.id);
        await db
          .update(activitiesTable)
          .set({ callStatus: "Completed", updatedAt: new Date(), updatedBy: user.id, isEdited: true })
          .where(inArray(activitiesTable.id, followUpIds));

        const allDealIds = contactDeals.map(d => d.id);

        if (allDealIds.length > 0) {
          const pendingDealFollowUps = await db
            .select({ id: activitiesTable.id })
            .from(activitiesTable)
            .where(
              and(
                eq(activitiesTable.type, "FollowUp"),
                eq(activitiesTable.contactId, null as any),
                inArray(activitiesTable.dealId, allDealIds),
                or(eq(activitiesTable.callStatus, "Pending"), isNull(activitiesTable.callStatus)),
              )
            );

          if (pendingDealFollowUps.length > 0) {
            await db
              .update(activitiesTable)
              .set({ callStatus: "Completed", updatedAt: new Date(), updatedBy: user.id, isEdited: true })
              .where(inArray(activitiesTable.id, pendingDealFollowUps.map(f => f.id)));

            followUpIds.push(...pendingDealFollowUps.map(f => f.id));
          }
        }

        // Mark related notifications as read
        await db
          .update(notificationsTable)
          .set({ readAt: new Date() })
          .where(
            and(
              inArray(notificationsTable.relatedId, followUpIds),
              eq(notificationsTable.relatedType, "activity"),
              isNull(notificationsTable.readAt),
            )
          );
      }
    }

    res.json({ success: true, moved: history.length, history });
  } catch (err) {
    req.log.error({ err }, "Move category error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/categories/history/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contactId" }); return; }

    const history = await db
      .select()
      .from(categoryHistoryTable)
      .where(eq(categoryHistoryTable.contactId, contactId))
      .orderBy(categoryHistoryTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    res.json(history.map(h => ({
      ...h,
      changedByUser: userMap.get(h.changedBy) ?? null
    })));
  } catch (err) {
    req.log.error({ err }, "Get category history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/categories/report", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";

    let contactConditions: SQL[] = [];
    if (!isAdmin) {
      contactConditions.push(eq(contactsTable.salesOwnerId, user.id));
    }

    const totalResult = await db
      .select({ count: sql`count(*)::int` })
      .from(contactsTable)
      .where(and(...contactConditions));
    const totalRecords = totalResult[0]?.count ?? 0;

    const categoryCounts = [];
    for (const category of CATEGORIES) {
      const catConditions = [eq(contactsTable.category, category), ...contactConditions];
      const [result] = await db
        .select({ count: sql`count(*)::int` })
        .from(contactsTable)
        .where(and(...catConditions));
      const count = result?.count ?? 0;
      categoryCounts.push({
        category,
        count,
        percentage: totalRecords > 0 ? Math.round((count / totalRecords) * 100) : 0,
      });
    }

    const movements = await db
      .select({
        fromCategory: categoryHistoryTable.previousCategory,
        toCategory: categoryHistoryTable.newCategory,
        count: sql`count(*)::int`,
      })
      .from(categoryHistoryTable)
      .groupBy(categoryHistoryTable.previousCategory, categoryHistoryTable.newCategory);

    const myClientsResult = await db
      .select({ count: sql`count(*)::int` })
      .from(contactsTable)
      .where(and(eq(contactsTable.category, "My Client"), ...contactConditions));
    const myClientsCount = myClientsResult[0]?.count ?? 0;
    const nonMyClientsCount = totalRecords - myClientsCount;
    const conversionRate = nonMyClientsCount > 0 && totalRecords > 0
      ? Math.round((myClientsCount / totalRecords) * 100)
      : 0;

    const topPerformers: any[] = [];
    if (isAdmin) {
      const allUsers = await db.select().from(usersTable);
      for (const u of allUsers) {
        const [convResult] = await db
          .select({ count: sql`count(*)::int` })
          .from(contactsTable)
          .where(and(
            eq(contactsTable.category, "My Client"),
            eq(contactsTable.salesOwnerId, u.id)
          ));
        topPerformers.push({
          userId: u.id,
          userName: u.name,
          colorCode: u.colorCode,
          conversions: convResult?.count ?? 0,
        });
      }
      topPerformers.sort((a, b) => b.conversions - a.conversions);
    }

    const lostOpportunities = [];
    for (const cat of CATEGORIES.filter(c => c !== "My Client")) {
      const catConditions = [eq(contactsTable.category, cat), ...contactConditions];
      const [wonResult] = await db
        .select({ count: sql`count(*)::int` })
        .from(contactsTable)
        .where(and(...catConditions));
      lostOpportunities.push({
        category: cat,
        count: wonResult?.count ?? 0,
      });
    }

    res.json({
      totalRecords,
      categoryCounts,
      movementHistory: movements,
      conversionRate,
      topPerformers: topPerformers.slice(0, 10),
      lostOpportunities,
    });
  } catch (err) {
    req.log.error({ err }, "Get category report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
