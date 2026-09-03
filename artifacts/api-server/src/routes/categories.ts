import { Router, type IRouter } from "express";
import { db, contactsTable, dealsTable, usersTable, categoryHistoryTable, activitiesTable, productsTable, dealProductsTable, CATEGORIES } from "@workspace/db";
import { eq, and, inArray, SQL, sql, desc, gte, lte, or, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { completePendingActivitiesForDeal } from "../lib/activity-helpers";
import { getAccessibleUnits } from "../lib/unit-filter";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";
import { parseEndDate } from "../lib/parse-end-date";
import { normalizeProfilePhotoUrl } from "../lib/storage";
import { daysSinceLastOrderOfDeals } from "../lib/retention-service";
import { logDealStageActivity } from "../lib/activity-logger";
import { deactivateActivePis } from "../lib/proforma-service";
import { emitEnquiryUpdated, emitDealUpdated } from "../lib/socket";

const router: IRouter = Router();

// Build the SQL condition for a unit filter, mirroring the /contacts list logic:
// "To Be Assigned" (pending) matches contacts whose unit is NULL or empty string.
function buildUnitCondition(unit: string | undefined): SQL | undefined {
  if (!unit) return undefined;
  if (unit === PENDING_UNIT_ASSIGNMENT) {
    return or(isNull(contactsTable.unit), eq(contactsTable.unit, "")) as SQL | undefined;
  }
  return eq(contactsTable.unit, unit);
}

// Return the single most recent deal's stage (createdAt DESC) plus the deals array sorted newest-first,
// so callers can show just the latest stage while other columns still access all deals.
function sortDealsByRecent(deals: (typeof dealsTable.$inferSelect)[]): { dealStage: string | null; sortedDeals: (typeof dealsTable.$inferSelect)[] } {
  const sortedDeals = [...deals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return { dealStage: sortedDeals[0]?.stage ?? null, sortedDeals };
}

router.get("/categories/counts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";
    const requestedUnit = req.query.unit as string | undefined;
    const requestedOwnerId = req.query.ownerId as string | undefined;
    const ownerId = requestedOwnerId ? Number(requestedOwnerId) : undefined;
    const hasOwnerFilter = ownerId !== undefined && !Number.isNaN(ownerId) && isAdmin;
    const unit = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;

    let conditions: SQL[] = [];
    if (!isAdmin) {
      conditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (hasOwnerFilter) {
      conditions.push(eq(contactsTable.salesOwnerId, ownerId!));
    }
    const unitCond = buildUnitCondition(unit);
    if (unitCond) {
      conditions.push(unitCond);
    }

    const { startDate, endDate } = req.query as Record<string, string>;
    if (startDate) conditions.push(gte(contactsTable.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(contactsTable.createdAt, parseEndDate(endDate)));

    // Fetch contacts and deals once for virtual "Regular Follow up" counting
    const allContacts = await db.select().from(contactsTable).where(and(...conditions));
    const allDeals = await db.select().from(dealsTable);

    // Count active (non-Won, non-Lost) deals per contact
    const activeDealContactIds = new Set<number>();
    for (const d of allDeals) {
      if (d.stage !== "Won" && d.stage !== "Lost" && allContacts.some(c => c.id === d.contactId)) {
        activeDealContactIds.add(d.contactId);
      }
    }

    const counts: { category: string; count: number }[] = CATEGORIES.map(category => {
      if (category === "Regular Follow up") {
        // Physical RFU contacts + My Client contacts with active deals
        const physicalCount = allContacts.filter(c => c.category === category).length;
        const virtualCount = allContacts.filter(c => c.category === "My Client" && activeDealContactIds.has(c.id)).length;
        return { category, count: physicalCount + virtualCount };
      }
      return { category, count: allContacts.filter(c => c.category === category).length };
    });

    // "Existing Client" count: ALL "My Client" contacts across all owners (bypass owner filter), only unit/date filtered
    // Unit filter uses requestedUnit from dropdown (not user's restricted unit) so badge matches list
    const ecConditions: SQL[] = [];
    if (user.role === "sales") {
      ecConditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (hasOwnerFilter) {
      ecConditions.push(eq(contactsTable.salesOwnerId, ownerId!));
    }
    const ecUnitCond = buildUnitCondition(requestedUnit);
    if (ecUnitCond) {
      ecConditions.push(ecUnitCond);
    }
    if (startDate) ecConditions.push(gte(contactsTable.createdAt, new Date(startDate)));
    if (endDate) ecConditions.push(lte(contactsTable.createdAt, parseEndDate(endDate)));
    const [ecResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactsTable)
      .where(and(eq(contactsTable.category, "My Client"), ...ecConditions));
    counts.push({ category: "Existing Client", count: ecResult?.count ?? 0 });

    res.json(counts);
  } catch (err) {
    req.log.error({ err }, "Get category counts error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/categories/:category/contacts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";
    const { category } = req.params;
    const requestedUnit = req.query.unit as string | undefined;
    const requestedOwnerId = req.query.ownerId as string | undefined;
    const ownerId = requestedOwnerId ? Number(requestedOwnerId) : undefined;
    const hasOwnerFilter = ownerId !== undefined && !Number.isNaN(ownerId) && isAdmin;
    const isExistingClient = category === "Existing Client";

    // Accept "Existing Client" (virtual category) or any DB CATEGORY
    if (!isExistingClient && !CATEGORIES.includes(category as any)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }

    const baseConditions: SQL[] = [];
    if (user.role === "sales") {
      baseConditions.push(eq(contactsTable.salesOwnerId, user.id));
    } else if (!isAdmin && !isExistingClient) {
      baseConditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    if (hasOwnerFilter) {
      baseConditions.push(eq(contactsTable.salesOwnerId, ownerId!));
    }

    // For Existing Client, unit filter comes from dropdown only (not user.unit)
    if (isExistingClient) {
      const ecUnitCond = buildUnitCondition(requestedUnit);
      if (ecUnitCond) {
        baseConditions.push(ecUnitCond);
      }
    } else {
      const unit = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;
      const unitCond = buildUnitCondition(unit);
      if (unitCond) {
        baseConditions.push(unitCond);
      }
    }

    let contacts: (typeof contactsTable.$inferSelect)[];
    if (category === "Regular Follow up") {
      // Physical RFU contacts
      const rfuContacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, category), ...baseConditions))
        .orderBy(desc(contactsTable.createdAt));
      // My Client contacts with active deals
      const myClientContacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, "My Client"), ...baseConditions))
        .orderBy(desc(contactsTable.createdAt));
      const allDeals = await db.select().from(dealsTable);
      const activeDealContactIds = new Set(
        allDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").map(d => d.contactId)
      );
      const virtualContacts = myClientContacts.filter(c => activeDealContactIds.has(c.id));
      contacts = [...rfuContacts, ...virtualContacts];
    } else {
      // Map "Existing Client" → "My Client" in the DB query
      const dbCategory = isExistingClient ? "My Client" : category;
      contacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, dbCategory), ...baseConditions))
        .orderBy(desc(contactsTable.createdAt));
    }

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, { ...safe, profilePhoto: normalizeProfilePhotoUrl(safe.profilePhoto) }];
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

    const latestCategoryHistoryByContact = new Map<number, typeof categoryHistoryTable.$inferSelect>();
    if (contactIds.length > 0) {
      const categoryHistories = await db
        .select()
        .from(categoryHistoryTable)
        .where(inArray(categoryHistoryTable.contactId, contactIds))
        .orderBy(desc(categoryHistoryTable.createdAt));
      for (const ch of categoryHistories) {
        if (!latestCategoryHistoryByContact.has(ch.contactId)) {
          latestCategoryHistoryByContact.set(ch.contactId, ch);
        }
      }
    }

    res.json(contacts.map(c => {
      const { dealStage, sortedDeals } = sortDealsByRecent(dealsByContact.get(c.id) ?? []);
      // "My Client" is the DB category behind both "My Client" and "Existing Client" views
      const showRetention = isExistingClient || category === "My Client";
      const latestCatHistory = latestCategoryHistoryByContact.get(c.id);
      return {
        ...c,
        salesOwner: userMap.get(c.salesOwnerId) ?? null,
        dealStage,
        leadLostReason: latestCatHistory?.reason || null,
        daysSinceLastOrder: showRetention ? daysSinceLastOrderOfDeals(dealsByContact.get(c.id) ?? []) : null,
        deals: sortedDeals.map(d => ({
          ...d,
          products: (dealProductsByDeal.get(d.id) ?? []).map(dp => ({
            ...dp,
            product: productMap.get(dp.productId) ?? null
          }))
        })),
        activities: activitiesByContact.get(c.id) ?? []
      };
    }));
  } catch (err) {
    req.log.error({ err }, "Get category contacts error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    const schConditions: SQL[] = [];
    if (!isAdmin) {
      schConditions.push(eq(contactsTable.salesOwnerId, user.id));
    }
    const unitCond = buildUnitCondition(unit);
    if (unitCond) {
      schConditions.push(unitCond);
    }
    if (q) {
      const s = `%${q}%`;
      schConditions.push(
        sql`(${contactsTable.name} ILIKE ${s} OR ${contactsTable.mobile} ILIKE ${s} OR ${contactsTable.companyName} ILIKE ${s} OR ${contactsTable.city} ILIKE ${s} OR ${contactsTable.customerCode} ILIKE ${s})`
      );
    }
    if (ownerId) schConditions.push(eq(contactsTable.salesOwnerId, Number(ownerId)));
    if (city) schConditions.push(sql`${contactsTable.city} ILIKE ${`%${city}%`}`);
    if (industry) schConditions.push(eq(contactsTable.industry, industry));

    let contacts: (typeof contactsTable.$inferSelect)[];
    if (category === "Regular Follow up") {
      const rfuContacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, category), ...schConditions))
        .orderBy(desc(contactsTable.createdAt));
      const myClientContacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, "My Client"), ...schConditions))
        .orderBy(desc(contactsTable.createdAt));
      const allDeals = await db.select().from(dealsTable);
      const activeDealContactIds = new Set(
        allDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").map(d => d.contactId)
      );
      const virtualContacts = myClientContacts.filter(c => activeDealContactIds.has(c.id));
      contacts = [...rfuContacts, ...virtualContacts];
    } else {
      contacts = await db
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.category, category), ...schConditions))
        .orderBy(desc(contactsTable.createdAt));
    }

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, { ...safe, profilePhoto: normalizeProfilePhotoUrl(safe.profilePhoto) }];
    }));

    const deals = await db.select().from(dealsTable);
    const dealsByContact = new Map<number, typeof deals>();
    for (const d of deals) {
      if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, []);
      dealsByContact.get(d.contactId)!.push(d);
    }

    const searchContactIds = contacts.map(c => c.id);
    const searchLatestCatHistoryByContact = new Map<number, typeof categoryHistoryTable.$inferSelect>();
    if (searchContactIds.length > 0) {
      const categoryHistories = await db
        .select()
        .from(categoryHistoryTable)
        .where(inArray(categoryHistoryTable.contactId, searchContactIds))
        .orderBy(desc(categoryHistoryTable.createdAt));
      for (const ch of categoryHistories) {
        if (!searchLatestCatHistoryByContact.has(ch.contactId)) {
          searchLatestCatHistoryByContact.set(ch.contactId, ch);
        }
      }
    }

    res.json(contacts.map(c => {
      const { dealStage, sortedDeals } = sortDealsByRecent(dealsByContact.get(c.id) ?? []);
      return {
        ...c,
        salesOwner: userMap.get(c.salesOwnerId) ?? null,
        dealStage,
        leadLostReason: searchLatestCatHistoryByContact.get(c.id)?.reason || null,
        deals: sortedDeals
      };
    }));
  } catch (err) {
    req.log.error({ err }, "Search category contacts error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    // Reason is mandatory — at least 5 non-space characters
    if (!reason || reason.trim().length < 5) {
      res.status(400).json({ error: "Reason is required and must be at least 5 characters." });
      return;
    }

    const isAdmin = user.role === "admin";

    const result = await db.transaction(async (tx) => {
      const history: any[] = [];
      const movedContactIds: number[] = [];
      const affectedDeals: { id: number; contactId: number; stage: string; salesOwnerId: number | null }[] = [];

      for (const contactId of contactIds) {
        const [contact] = await tx
          .select()
          .from(contactsTable)
          .where(eq(contactsTable.id, contactId));

        if (!contact) continue;
        if (!isAdmin && contact.salesOwnerId !== user.id) continue;

        // EXCEPTION: Permanent My Clients (isMyClient=true) ALWAYS stay in My Clients
        if (contact.isMyClient) continue;

        const prevCategory = contact.category;

        await tx
          .update(contactsTable)
          .set({ category: newCategory, updatedAt: new Date() })
          .where(eq(contactsTable.id, contactId));

        const [h] = await tx
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

      // If moving away from "Regular Follow up" to dead categories ("Category A", "Category B", "Category C"),
      // check for ANY active deals (stage not in "Won", "Lost") and automatically mark them as Lost with the provided reason.
      if (newCategory !== "Regular Follow up" && movedContactIds.length > 0) {
        // Find ALL active deals for moved contacts (any stage except Won and Lost)
        const activeDeals = await tx
          .select({
            id: dealsTable.id,
            contactId: dealsTable.contactId,
            stage: dealsTable.stage,
            salesOwnerId: dealsTable.salesOwnerId,
          })
          .from(dealsTable)
          .where(and(
            inArray(dealsTable.contactId, movedContactIds),
            sql`${dealsTable.stage} NOT IN ('Won', 'Lost')`,
          ));

        if (activeDeals.length > 0) {
          const now = new Date();
          const activeDealIds = activeDeals.map((d) => d.id);

          await tx
            .update(dealsTable)
            .set({
              stage: "Lost",
              lostReason: reason.trim(),
              updatedAt: now,
              completedAt: now,
            })
            .where(inArray(dealsTable.id, activeDealIds));

          // For each affected deal:
          for (const deal of activeDeals) {
            affectedDeals.push(deal);

            // 1. Deactivate active Proforma Invoices for this deal
            await deactivateActivePis(tx, deal.id);

            // 2. Log deal stage change activity
            await logDealStageActivity(tx, {
              dealId: deal.id,
              contactId: deal.contactId,
              fromStage: deal.stage,
              toStage: "Lost",
              userName: user.name,
              createdBy: user.id,
              extraNotes: reason.trim(),
            });

            // 3. Auto-complete all pending activities for this deal
            await completePendingActivitiesForDeal(tx, deal.id, deal.contactId, "Lost", user.id);
          }
        }
      }

      return { history, movedContactIds, affectedDeals };
    });

    // Broadcast real-time socket events after successful transaction commit
    for (const contactId of result.movedContactIds) {
      emitEnquiryUpdated(contactId, null);
    }
    for (const deal of result.affectedDeals) {
      emitDealUpdated(deal.id, deal.contactId, deal.salesOwnerId);
    }

    res.json({ success: true, moved: result.history.length, history: result.history });
  } catch (err) {
    req.log.error({ err }, "Move category error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/categories/history/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contactId" }); return; }

    // Enforce access: non-admin must own the contact or be in the same unit
    if (user.role !== "admin") {
      const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId, unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, contactId));
      if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
      if (user.role === "sales" && contact.salesOwnerId !== user.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
      const units = getAccessibleUnits(user);
      if (units && (!contact.unit || !units.includes(contact.unit))) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    const history = await db
      .select()
      .from(categoryHistoryTable)
      .where(eq(categoryHistoryTable.contactId, contactId))
      .orderBy(categoryHistoryTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, { ...safe, profilePhoto: normalizeProfilePhotoUrl(safe.profilePhoto) }];
    }));

    res.json(history.map(h => ({
      ...h,
      changedByUser: userMap.get(h.changedBy) ?? null
    })));
  } catch (err) {
    req.log.error({ err }, "Get category history error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
      .select({ count: sql`count(*)::int`.mapWith(Number) })
      .from(contactsTable)
      .where(and(...contactConditions));
    const totalRecords = totalResult[0]?.count ?? 0;

    const categoryCounts = [];
    for (const category of CATEGORIES) {
      const catConditions = [eq(contactsTable.category, category), ...contactConditions];
      const [result] = await db
        .select({ count: sql`count(*)::int`.mapWith(Number) })
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
      .select({ count: sql`count(*)::int`.mapWith(Number) })
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
          username: u.username,
          colorCode: u.colorCode,
          profilePhoto: normalizeProfilePhotoUrl(u.profilePhoto),
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
