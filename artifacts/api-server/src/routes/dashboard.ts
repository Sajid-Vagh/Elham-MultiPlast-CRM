import { Router, type IRouter } from "express";
import { db, contactsTable, dealsTable, usersTable, activitiesTable, ordersTable, complaintsTable, productionOrdersTable, CATEGORIES, DEAL_STAGES } from "@workspace/db";
import { eq, inArray, and, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";

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
  const contactIds = new Set(allContacts.filter(c => c.unit === unit).map(c => c.id));
  return deals.filter(d => contactIds.has(d.contactId));
}

async function getUser(req: any) {
  const user = await getUserFromRequest(req);
  if (!user) return null;

  const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  const requestedUnit = req.query.unit as string | undefined;
  const unitFilter = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;

  // Admin with specific owner filter
  let effectiveOwnerId: number | undefined;
  if (user.role === "admin" && ownerId) {
    effectiveOwnerId = ownerId;
  } else if (user.role === "sales") {
    effectiveOwnerId = user.id;
  }

  return { user, effectiveOwnerId, unitFilter, isAdmin: user.role === "admin" };
}

router.get("/dashboard/kpi", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { user, effectiveOwnerId, unitFilter, isAdmin } = ctx;

    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(eq(contactsTable.salesOwnerId, effectiveOwnerId))
      : await db.select().from(contactsTable);

    const filteredContacts = filterContactsByUnit(allContacts, unitFilter);

    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(eq(dealsTable.salesOwnerId, effectiveOwnerId))
      : await db.select().from(dealsTable);

    const filteredDeals = filterDealsByUnit(allDeals, unitFilter, allContacts);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = now.toISOString().split("T")[0]!;

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

    // Activities: scope to owner and apply unit filter via contacts
    let activitiesQuery = db.select().from(activitiesTable);
    const activityConditions: any[] = [];
    if (effectiveOwnerId) {
      const userContactIds = (await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.salesOwnerId, effectiveOwnerId))).map(c => c.id);
      if (userContactIds.length > 0) {
        activityConditions.push(inArray(activitiesTable.contactId, userContactIds));
      } else {
        activityConditions.push(eq(activitiesTable.contactId, -1)); // no results
      }
    }
    let activitiesQueryResult = activityConditions.length > 0
      ? await db.select().from(activitiesTable).where(and(...activityConditions))
      : await db.select().from(activitiesTable);

    const todayActivities = activitiesQueryResult.filter(a => a.followUpDate === today);
    const todayTotal = todayActivities.length;
    const todayCompleted = todayActivities.filter(a => a.callStatus === "Completed").length;
    const todayPending = todayActivities.filter(a => a.callStatus === "Pending").length;

    const dueContacts = filteredContacts.filter(c => c.nextCallDate && c.nextCallDate < today);
    const overdueCount = dueContacts.length;

    const newLeadsThisMonth = filteredContacts.filter(c => c.createdAt >= monthStart).length;

    const myClientsCount = filteredContacts.filter(c => c.category === "My Client").length;
    const conversionRate = totalContacts > 0 ? Math.round((myClientsCount / totalContacts) * 100) : 0;

    // Order-based KPIs: NEW vs REPEAT revenue
    const accessUnitFilter = unitFilter;
    let allOrders = await db.select().from(ordersTable);
    let filteredOrders = allOrders;
    if (effectiveOwnerId) {
      filteredOrders = allOrders.filter(o => o.revenueOwnerId === effectiveOwnerId || o.salesOwnerId === effectiveOwnerId);
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
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/sales-performance", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { user, effectiveOwnerId, unitFilter, isAdmin } = ctx;

    if (!isAdmin) {
      res.json([]);
      return;
    }

    const allUsers = await db.select().from(usersTable);
    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(eq(contactsTable.salesOwnerId, effectiveOwnerId))
      : await db.select().from(contactsTable);
    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(eq(dealsTable.salesOwnerId, effectiveOwnerId))
      : await db.select().from(dealsTable);
    const allActivities = await db.select().from(activitiesTable);

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
        profilePhoto: u.profilePhoto,
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
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/charts", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { effectiveOwnerId, unitFilter } = ctx;

    const allContacts = effectiveOwnerId
      ? await db.select().from(contactsTable).where(eq(contactsTable.salesOwnerId, effectiveOwnerId))
      : await db.select().from(contactsTable);

    const allDeals = effectiveOwnerId
      ? await db.select().from(dealsTable).where(eq(dealsTable.salesOwnerId, effectiveOwnerId))
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
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/recent-activities", async (req, res) => {
  try {
    const ctx = await getUser(req);
    if (!ctx) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { effectiveOwnerId, unitFilter } = ctx;

    let activities = await db
      .select()
      .from(activitiesTable)
      .orderBy(activitiesTable.createdAt)
      .limit(50);

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
        return c?.unit === unitFilter;
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
    res.status(500).json({ error: "Internal server error" });
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

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Repeat orders
    const allOrders = await db.select().from(ordersTable);
    const repeatOrders = allOrders.filter(o => o.orderType === "REPEAT" && !o.isDeleted);
    const repeatOrdersThisMonth = repeatOrders.filter(o => o.createdAt >= monthStart);
    const totalRepeatRevenue = repeatOrders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);
    const repeatRevenueThisMonth = repeatOrdersThisMonth.reduce((s, o) => s + Number(o.grandTotal || 0), 0);

    // Repeat customers (unique contacts with REPEAT orders)
    const repeatCustomerIds = new Set(repeatOrders.map(o => o.contactId).filter(Boolean));

    // Active complaints
    const complaints = await db.select().from(complaintsTable);
    const activeComplaints = complaints.filter(c => c.status !== "Resolved" && c.status !== "Closed").length;

    // Production orders with dispatch workflow
    const allProductionOrders = await db.select().from(productionOrdersTable);

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

    // Active complaints list for the dashboard
    const activeComplaintList = complaints.filter(c => c.status !== "Resolved" && c.status !== "Closed").slice(0, 10);

    res.json({
      totalRepeatOrders: repeatOrders.length,
      repeatOrdersThisMonth: repeatOrdersThisMonth.length,
      totalRepeatRevenue,
      repeatRevenueThisMonth,
      repeatCustomers: repeatCustomerIds.size,
      activeComplaints,
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
        complaints: activeComplaintList,
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
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
