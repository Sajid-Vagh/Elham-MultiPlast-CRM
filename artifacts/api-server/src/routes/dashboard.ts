import { Router, type IRouter } from "express";
import { db, contactsTable, dealsTable, usersTable, activitiesTable, ordersTable, productionOrdersTable, CATEGORIES, DEAL_STAGES } from "@workspace/db";
import { eq, inArray, and, desc, gte, lte, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";
import { getAccessibleUnits } from "../lib/unit-filter";
import { normalizeProfilePhotoUrl } from "../lib/storage";

const router: IRouter = Router();

function filterContactsByUnit(contacts: (typeof contactsTable.$inferSelect)[], unit: string | undefined) {
  if (!unit) return contacts;
  if (unit === PENDING_UNIT_ASSIGNMENT) {
    return contacts.filter(c => !c.unit);
  }
  return contacts.filter(c => c.unit === unit);
}

function filterDealsByUnit(deals: (typeof dealsTable.$inferSelect)[], unit: string | undefined, allContacts: (typeof contactsTable.$inferSelect)[]) {
  if (!unit) return deals;
  const contactIds = new Set(filterContactsByUnit(allContacts, unit).map(c => c.id));
  return deals.filter(d => contactIds.has(d.contactId));
}

// Local yyyy-MM-dd date string in the SERVER's timezone. The frontend passes its
// own local `today` when available so follow-up dates are never compared against
// a UTC-derived date (which is off-by-one during morning hours for +05:30 / +05:45).
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Scopes activities to the current user + optional unit/owner filters, resolving
// each activity's effective contact via its deal when it has no direct contactId.
// The scoping mirrors the Activity page EXACTLY (activities.ts + follow-ups.tsx):
//   - sales / production            → activities the user CREATED (createdBy)
//   - production_and_support        → createdBy OR assignedTo
//   - admin with ownerFilter        → activities whose effective contact's
//                                     salesOwnerId matches (same as salesPersonId)
//   - unit filter                   → effective contact's unit (Pending-Unit keeps
//                                     contacts with NO unit)
// Shared by the KPI counts and any future list endpoint so both can NEVER disagree
// about what an activity is — the root cause of the previous bug where the counter
// used contacts.nextCallDate while the Activity page used activities.followUpDate.
async function getScopedActivities(
  user: { id: number; role: string },
  adminOwnerId: number | undefined,
  unitFilter: string | undefined,
  activityDateConds: any[]
) {
  const conditions: any[] = [];
  if (user.role === "sales" || user.role === "production") {
    conditions.push(eq(activitiesTable.createdBy, user.id));
  } else if (user.role === "production_and_support") {
    conditions.push(or(
      eq(activitiesTable.createdBy, user.id),
      eq(activitiesTable.assignedTo, user.id),
    )!);
  }
  // Admin sees all — owner filter applied below via effective contact
  if (activityDateConds.length > 0) conditions.push(...activityDateConds);

  const activitiesQueryResult = conditions.length > 0
    ? await db.select().from(activitiesTable).where(and(...conditions))
    : await db.select().from(activitiesTable);

  // Activities may be linked to a contact directly, or only via their deal.
  // Resolve each activity's effective contact id (same resolution the
  // Activity page uses: activity.contactId ?? activity.deal.contactId) so the
  // unit + owner filters behave identically to the table.
  const dealIdSet = new Set(activitiesQueryResult.map(a => a.dealId).filter(Boolean)) as Set<number>;
  let dealContactMap = new Map<number, number>();
  if (dealIdSet.size > 0) {
    const deals = await db
      .select({ id: dealsTable.id, contactId: dealsTable.contactId })
      .from(dealsTable)
      .where(inArray(dealsTable.id, [...dealIdSet]));
    dealContactMap = new Map(deals.map(d => [d.id, d.contactId]));
  }

  const effectiveContactIds = new Set<number>();
  for (const a of activitiesQueryResult) {
    const cid = a.contactId ?? (a.dealId ? dealContactMap.get(a.dealId) : undefined);
    if (cid) effectiveContactIds.add(cid);
  }
  let contactMap = new Map<number, (typeof contactsTable.$inferSelect)>();
  if (effectiveContactIds.size > 0) {
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(inArray(contactsTable.id, [...effectiveContactIds]));
    contactMap = new Map(contacts.map(c => [c.id, c]));
  }

  return activitiesQueryResult.filter(a => {
    const cid = a.contactId ?? (a.dealId ? dealContactMap.get(a.dealId) : undefined);
    const contact = cid ? contactMap.get(cid) : undefined;
    if (user.role === "admin" && adminOwnerId) {
      if (!contact || contact.salesOwnerId !== adminOwnerId) return false;
    }
    if (unitFilter) {
      const contactUnit = contact?.unit;
      if (unitFilter === PENDING_UNIT_ASSIGNMENT) {
        if (contactUnit) return false;
      } else if (contactUnit !== unitFilter) {
        return false;
      }
    }
    return true;
  });
}

async function getUser(req: any) {
  const user = await getUserFromRequest(req);
  if (!user) return null;

  const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  const requestedUnit = req.query.unit as string | undefined;
  const unitFilter = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;

  // Admin sees global data (or specific owner if ?ownerId= set); everyone else sees only their own
  let effectiveOwnerId: number | undefined;
  if (user.role === "admin") {
    effectiveOwnerId = ownerId;
  } else {
    effectiveOwnerId = user.id;
  }

  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  return { user, effectiveOwnerId, unitFilter, isAdmin: user.role === "admin", startDate, endDate };
}

router.get("/dashboard/kpi", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { user, effectiveOwnerId, unitFilter, isAdmin, startDate, endDate } = ctx;

    // Build date conditions for SQL-level filtering
    const contactDateConds: any[] = [];
    const dealDateConds: any[] = [];
    const orderDateConds: any[] = [];
    if (startDate) { contactDateConds.push(gte(contactsTable.createdAt, new Date(startDate))); dealDateConds.push(gte(dealsTable.createdAt, new Date(startDate))); orderDateConds.push(gte(ordersTable.createdAt, new Date(startDate))); }
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); contactDateConds.push(lte(contactsTable.createdAt, end)); dealDateConds.push(lte(dealsTable.createdAt, end)); orderDateConds.push(lte(ordersTable.createdAt, end)); }

    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(and(eq(contactsTable.salesOwnerId, effectiveOwnerId), ...contactDateConds))
      : contactDateConds.length > 0
        ? await db.select().from(contactsTable).where(and(...contactDateConds))
        : await db.select().from(contactsTable);

    const filteredContacts = filterContactsByUnit(allContacts, unitFilter);

    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(and(eq(dealsTable.salesOwnerId, effectiveOwnerId), ...dealDateConds))
      : dealDateConds.length > 0
        ? await db.select().from(dealsTable).where(and(...dealDateConds))
        : await db.select().from(dealsTable);

    const filteredDeals = filterDealsByUnit(allDeals, unitFilter, allContacts);

    const now = new Date();
    // Use the client's local date string when supplied (frontend sends its own
    // todayStr()) so "today"/"overdue" are decided in the SAME timezone the
    // Activity page table uses. Fall back to the server-local date otherwise.
    // Never toISOString(): that yields the UTC date, which is wrong for
    // +05:30/+05:45 regions between midnight and ~05:30 local.
    const rawToday = req.query.today as string | undefined;
    const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday) ? rawToday : localDateStr(now);

    const totalContacts = filteredContacts.length;
    const totalDeals = filteredDeals.length;
    const wonDeals = filteredDeals.filter(d => d.stage === "Won").length;
    const lostDeals = filteredDeals.filter(d => d.stage === "Lost").length;
    const lostLeads = filteredContacts.filter(c => c.lostReason != null).length;
    const activeDeals = filteredDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length;
    const totalWonValue = filteredDeals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? 0), 0);

    const activeDealContactIds = new Set(
      filteredDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").map(d => d.contactId)
    );
    const categoryCounts = CATEGORIES.map(category => {
      if (category === "Regular Follow up") {
        const physicalCount = filteredContacts.filter(c => c.category === category).length;
        const virtualCount = filteredContacts.filter(c => c.category === "My Client" && activeDealContactIds.has(c.id)).length;
        return { category, count: physicalCount + virtualCount };
      }
      return { category, count: filteredContacts.filter(c => c.category === category).length };
    });

    const unitStats: Record<string, number> = {};
    for (const c of filteredContacts) {
      const u = c.unit || PENDING_UNIT_ASSIGNMENT;
      unitStats[u] = (unitStats[u] || 0) + 1;
    }

    // Activities: scope to owner and apply unit filter via contacts.
    // The date-range filter matches the Activity page (activities.ts): it applies
    // to followUpDate, NOT record createdAt, so the cards reflect exactly what the
    // table shows for the same selected date range.
    const activityDateCondsLocal: any[] = [];
    if (startDate) activityDateCondsLocal.push(gte(activitiesTable.followUpDate, startDate));
    if (endDate) activityDateCondsLocal.push(lte(activitiesTable.followUpDate, endDate));
    const scopedActivities = await getScopedActivities(
      user,
      isAdmin ? effectiveOwnerId : undefined,
      unitFilter,
      activityDateCondsLocal
    );

    const todayActivities = scopedActivities.filter(a => a.followUpDate === today);
    const todayTotal = todayActivities.length;
    const todayCompleted = todayActivities.filter(a => a.callStatus === "Completed").length;
    const todayPending = todayActivities.filter(a => a.callStatus === "Pending").length;

    // Overdue mirrors the Activity page's "Overdue" status filter exactly
    // (follow-ups.tsx): followUpDate < today && callStatus === "Pending".
    // followUpDate is a yyyy-MM-dd string, so a plain string comparison is both
    // timezone-safe and identical to the frontend's date-only comparison.
    const overdueCount = scopedActivities.filter(a =>
      !!a.followUpDate && a.followUpDate < today && a.callStatus === "Pending"
    ).length;

    const newLeadsThisMonth = filteredContacts.length;

    const myClientsCount = filteredContacts.filter(c => c.category === "My Client").length;
    const conversionRate = totalContacts > 0 ? Math.round((myClientsCount / totalContacts) * 100) : 0;

    // Order-based KPIs: NEW vs REPEAT revenue
    const accessUnitFilter = unitFilter;
    let filteredOrders = orderDateConds.length > 0
      ? await db.select().from(ordersTable).where(and(...orderDateConds))
      : await db.select().from(ordersTable);
    if (effectiveOwnerId) {
      filteredOrders = filteredOrders.filter(o => o.revenueOwnerId === effectiveOwnerId || o.salesOwnerId === effectiveOwnerId);
    }
    if (accessUnitFilter) {
      const unitContactIds = new Set(filterContactsByUnit(allContacts, accessUnitFilter).map(c => c.id));
      filteredOrders = filteredOrders.filter(o => unitContactIds.has(o.contactId));
    }

    const newOrders = filteredOrders.filter(o => o.orderType === "NEW");
    const repeatOrders = filteredOrders.filter(o => o.orderType === "REPEAT");

    const newOrderRevenue = newOrders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);
    const repeatOrderRevenue = repeatOrders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);
    const totalOrderRevenue = newOrderRevenue + repeatOrderRevenue;

    res.json({
      totalContacts,
      totalDeals,
      wonDeals,
      lostDeals,
      lostLeads,
      activeDeals,
      totalWonValue,
      unitStats,
      todayTotal,
      todayCompleted,
      todayPending,
      overdueCount,
      newLeadsThisMonth,
      myClientsCount,
      conversionRate,
      // Order-based KPIs
      newOrders: newOrders.length,
      newOrderRevenue,
      repeatOrders: repeatOrders.length,
      repeatOrderRevenue,
      totalOrderRevenue,
    });
  } catch (err) {
    req.log.error({ err }, "Dashboard KPI error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/dashboard/sales-performance", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { user, effectiveOwnerId, unitFilter, isAdmin, startDate, endDate } = ctx;

    if (!isAdmin) {
      res.json([]);
      return;
    }

    const contactDateConds: any[] = [];
    const dealDateConds: any[] = [];
    const activityDateConds: any[] = [];
    if (startDate) { contactDateConds.push(gte(contactsTable.createdAt, new Date(startDate))); dealDateConds.push(gte(dealsTable.createdAt, new Date(startDate))); activityDateConds.push(gte(activitiesTable.createdAt, new Date(startDate))); }
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); contactDateConds.push(lte(contactsTable.createdAt, end)); dealDateConds.push(lte(dealsTable.createdAt, end)); activityDateConds.push(lte(activitiesTable.createdAt, end)); }

    const allUsers = await db.select().from(usersTable);
    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(and(eq(contactsTable.salesOwnerId, effectiveOwnerId), ...contactDateConds))
      : contactDateConds.length > 0
        ? await db.select().from(contactsTable).where(and(...contactDateConds))
        : await db.select().from(contactsTable);
    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(and(eq(dealsTable.salesOwnerId, effectiveOwnerId), ...dealDateConds))
      : dealDateConds.length > 0
        ? await db.select().from(dealsTable).where(and(...dealDateConds))
        : await db.select().from(dealsTable);
    const allActivities = activityDateConds.length > 0
      ? await db.select().from(activitiesTable).where(and(...activityDateConds))
      : await db.select().from(activitiesTable);

    // Only include sales users
    const salesUsers = allUsers.filter(u => u.role === "admin" || u.role === "sales");

    const result = salesUsers.map(u => {
      const userContacts = filterContactsByUnit(allContacts.filter(c => c.salesOwnerId === u.id), unitFilter);
      const userDeals = filterDealsByUnit(allDeals.filter(d => d.salesOwnerId === u.id), unitFilter, allContacts);
      const contactIds = new Set(userContacts.map(c => c.id));
      const userActivities = allActivities.filter(a => a.contactId && contactIds.has(a.contactId));

      const totalContacts = userContacts.length;
      const totalDeals = userDeals.length;
      const wonDeals = userDeals.filter(d => d.stage === "Won").length;
      const lostDeals = userDeals.filter(d => d.stage === "Lost").length;
      const activeDeals = userDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length;
      const totalWonValue = userDeals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? 0), 0);
      const myClients = userContacts.filter(c => c.category === "My Client").length;
      const conversionRate = totalContacts > 0 ? Math.round((myClients / totalContacts) * 100) : 0;

      const totalFollowUps = userActivities.filter(a => a.type === "FollowUp").length;
      const completedFollowUps = userActivities.filter(a => a.type === "FollowUp" && a.callStatus === "Completed").length;
      const followUpRate = totalFollowUps > 0 ? Math.round((completedFollowUps / totalFollowUps) * 100) : 0;

      return {
        userId: u.id,
        userName: u.name,
        username: u.username,
        colorCode: u.colorCode,
        profilePhoto: normalizeProfilePhotoUrl(u.profilePhoto),
        unit: u.unit,
        totalContacts,
        totalDeals,
        wonDeals,
        lostDeals,
        activeDeals,
        totalWonValue,
        myClients,
        conversionRate,
        followUpRate,
      };
    });

    result.sort((a, b) => b.totalWonValue - a.totalWonValue);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Sales performance error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/dashboard/charts", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { effectiveOwnerId, unitFilter, startDate, endDate } = ctx;

    const contactDateConds: any[] = [];
    const dealDateConds: any[] = [];
    if (startDate) { contactDateConds.push(gte(contactsTable.createdAt, new Date(startDate))); dealDateConds.push(gte(dealsTable.createdAt, new Date(startDate))); }
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); contactDateConds.push(lte(contactsTable.createdAt, end)); dealDateConds.push(lte(dealsTable.createdAt, end)); }

    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(and(eq(contactsTable.salesOwnerId, effectiveOwnerId), ...contactDateConds))
      : contactDateConds.length > 0
        ? await db.select().from(contactsTable).where(and(...contactDateConds))
        : await db.select().from(contactsTable);

    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(and(eq(dealsTable.salesOwnerId, effectiveOwnerId), ...dealDateConds))
      : dealDateConds.length > 0
        ? await db.select().from(dealsTable).where(and(...dealDateConds))
        : await db.select().from(dealsTable);

    const filteredContacts = filterContactsByUnit(allContacts, unitFilter);
    const filteredDeals = filterDealsByUnit(allDeals, unitFilter, allContacts);

    const activeDealContactIdsCharts = new Set(
      filteredDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").map(d => d.contactId)
    );
    const categoryDistribution = CATEGORIES.map(category => {
      if (category === "Regular Follow up") {
        const physicalCount = filteredContacts.filter(c => c.category === category).length;
        const virtualCount = filteredContacts.filter(c => c.category === "My Client" && activeDealContactIdsCharts.has(c.id)).length;
        return { name: category, value: physicalCount + virtualCount };
      }
      return { name: category, value: filteredContacts.filter(c => c.category === category).length };
    });

    const dealStageDistribution = DEAL_STAGES.map(stage => ({
      stage,
      count: filteredDeals.filter(d => d.stage === stage).length,
    }));

    const monthlyTrends: { month: string; contacts: number; deals: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const label = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
      monthlyTrends.push({
        month: label,
        contacts: filteredContacts.filter(c => c.createdAt >= monthStart && c.createdAt < monthEnd).length,
        deals: filteredDeals.filter(d => d.createdAt >= monthStart && d.createdAt < monthEnd).length,
      });
    }

    res.json({ categoryDistribution, dealStageDistribution, monthlyTrends });
  } catch (err) {
    req.log.error({ err }, "Dashboard charts error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/dashboard/recent-activities", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { effectiveOwnerId, unitFilter, startDate, endDate } = ctx;

    const dateConds: any[] = [];
    if (startDate) dateConds.push(gte(activitiesTable.createdAt, new Date(startDate)));
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); dateConds.push(lte(activitiesTable.createdAt, end)); }

    let activities = dateConds.length > 0
      ? await db.select().from(activitiesTable).where(and(...dateConds)).orderBy(desc(activitiesTable.createdAt)).limit(50)
      : await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(50);

    if (effectiveOwnerId) {
      const userContacts = await db
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(eq(contactsTable.salesOwnerId, effectiveOwnerId));
      const userContactIds = new Set(userContacts.map(c => c.id));
      activities = activities.filter(a => a.contactId && userContactIds.has(a.contactId));
    }

    const activityContactIds = [...new Set(activities.map(a => a.contactId).filter(Boolean))] as number[];
    let contacts: (typeof contactsTable.$inferSelect)[] = [];
    if (activityContactIds.length > 0) {
      contacts = await db.select().from(contactsTable).where(inArray(contactsTable.id, activityContactIds));
    }
    let contactMap = new Map(contacts.map(c => [c.id, c]));

    // Apply unit filter on activities via contacts
    if (unitFilter) {
      activities = activities.filter(a => {
        const c = contactMap.get(a.contactId ?? -1);
        if (!c) return false;
        if (unitFilter === PENDING_UNIT_ASSIGNMENT) return !c.unit;
        return c.unit === unitFilter;
      });
    }

    const userIds = [...new Set(activities.map(a => a.createdBy).filter(Boolean))] as number[];
    let users: (typeof usersTable.$inferSelect)[] = [];
    if (userIds.length > 0) {
      users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
    }
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const result = activities.slice(0, 20).map(a => ({
      id: a.id,
      type: a.type,
      notes: a.notes,
      callStatus: a.callStatus,
      followUpDate: a.followUpDate,
      contactId: a.contactId,
      contactName: contactMap.get(a.contactId ?? -1)?.name ?? "Unknown",
      createdBy: a.createdBy,
      createdByName: userMap.get(a.createdBy ?? -1) ?? "System",
      createdAt: a.createdAt,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Recent activities error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── Support Dashboard KPI ──
router.get("/dashboard/support-kpi", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "production_and_support") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const orderDateConds: any[] = [eq(ordersTable.isDeleted, false)];
    const prodDateConds: any[] = [];
    if (startDate) { orderDateConds.push(gte(ordersTable.createdAt, new Date(startDate))); prodDateConds.push(gte(productionOrdersTable.createdAt, new Date(startDate))); }
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); orderDateConds.push(lte(ordersTable.createdAt, end)); prodDateConds.push(lte(productionOrdersTable.createdAt, end)); }

    // Unit isolation for support-kpi (honor ?unit= for admin / unit-All users)
    const requestedUnit = req.query.unit as string | undefined;
    const accessibleUnits = getAccessibleUnits(user);
    const unitFilter = accessibleUnits ? accessibleUnits : (requestedUnit && requestedUnit !== "All" ? [requestedUnit] : null);
    if (unitFilter) {
      orderDateConds.push(inArray(ordersTable.productionUnit, unitFilter));
      prodDateConds.push(inArray(productionOrdersTable.productionUnit, unitFilter));
    }

    // Repeat orders
    const allOrders = await db.select().from(ordersTable).where(and(...orderDateConds));
    const repeatOrders = allOrders.filter(o => o.orderType === "REPEAT");
    const totalRepeatRevenue = repeatOrders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);

    // Repeat customers (unique contacts with REPEAT orders)
    const repeatCustomerIds = new Set(repeatOrders.map(o => o.contactId).filter(Boolean));

    // Production orders with dispatch workflow
    const allProductionOrders = prodDateConds.length > 0
      ? await db.select().from(productionOrdersTable).where(and(...prodDateConds))
      : await db.select().from(productionOrdersTable);

    // Dispatch KPIs from new dispatch workflow
    const rtdOrders = allProductionOrders.filter(o => o.status === "Ready To Dispatch");
    const pendingDispatch = rtdOrders.filter(o => o.dispatchStatus === "Pending Dispatch" || !o.dispatchStatus).length;
    const loadVehicle = rtdOrders.filter(o => o.dispatchStatus === "Load Vehicle").length;
    const dispatched = rtdOrders.filter(o => o.dispatchStatus === "Dispatch").length;
    const delivered = allProductionOrders.filter(o => o.dispatchStatus === "Delivered").length;

    // Production KPIs
    const inProduction = allProductionOrders.filter(o =>
      o.status === "Production On Going" || o.status === "Packaging"
    ).length;

    res.json({
      totalRepeatOrders: repeatOrders.length,
      repeatOrdersThisMonth: repeatOrders.length,
      totalRepeatRevenue,
      repeatRevenueThisMonth: totalRepeatRevenue,
      repeatCustomers: repeatCustomerIds.size,
      pendingDispatch,
      inProduction,
      readyForDispatch: pendingDispatch,
      loadVehicle,
      dispatched,
      delivered,
      inTransport: loadVehicle + dispatched,
      collections: {
        repeatOrders: repeatOrders.slice(0, 10),
        pendingDispatch: rtdOrders.filter(o => o.dispatchStatus === "Pending Dispatch" || !o.dispatchStatus).slice(0, 10),
        productionOrders: allProductionOrders.filter(o => o.status === "Production On Going").slice(0, 10),
        customers: [],
      },
      stats: {
        repeatRevenue: totalRepeatRevenue,
        repeatCustomers: repeatCustomerIds.size,
        pendingDispatch,
        inProduction,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Support KPI error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
