import { Router, type IRouter } from "express";
import { db, contactsTable, dealsTable, usersTable, activitiesTable, CATEGORIES, DEAL_STAGES } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

async function restrictToOwn(req: any) {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  return user;
}

router.get("/dashboard/kpi", async (req, res) => {
  try {
    const user = await restrictToOwn(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";

    const allContacts = isAdmin
      ? await db.select().from(contactsTable)
      : await db.select().from(contactsTable).where(eq(contactsTable.salesOwnerId, user.id));

    const allDeals = isAdmin
      ? await db.select().from(dealsTable)
      : await db.select().from(dealsTable).where(eq(dealsTable.salesOwnerId, user.id));

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = now.toISOString().split("T")[0]!;

    const totalContacts = allContacts.length;
    const totalDeals = allDeals.length;
    const wonDeals = allDeals.filter(d => d.stage === "Won").length;
    const lostDeals = allDeals.filter(d => d.stage === "Lost").length;
    const activeDeals = allDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length;
    const totalWonValue = allDeals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? d.totalValue ?? 0), 0);

    const categoryCounts = CATEGORIES.map(category => ({
      category,
      count: allContacts.filter(c => c.category === category).length,
    }));

    const unitStats: Record<string, number> = {};
    for (const c of allContacts) {
      const u = c.unit || "Unassigned";
      unitStats[u] = (unitStats[u] || 0) + 1;
    }

    const todayActivities = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.followUpDate, today));
    const todayTotal = todayActivities.length;
    const todayCompleted = todayActivities.filter(a => a.callStatus === "Completed").length;
    const todayPending = todayTotal - todayCompleted;

    const dueContacts = allContacts.filter(c => c.nextCallDate && c.nextCallDate < today);
    const overdueCount = dueContacts.length;

    const newLeadsThisMonth = allContacts.filter(c => c.createdAt >= monthStart).length;

    const myClientsCount = allContacts.filter(c => c.category === "My Client").length;
    const conversionRate = totalContacts > 0 ? Math.round((myClientsCount / totalContacts) * 100) : 0;

    res.json({
      totalContacts,
      totalDeals,
      wonDeals,
      lostDeals,
      activeDeals,
      totalWonValue,
      categoryCounts,
      unitStats,
      todayTotal,
      todayCompleted,
      todayPending,
      overdueCount,
      newLeadsThisMonth,
      myClientsCount,
      conversionRate,
    });
  } catch (err) {
    req.log.error({ err }, "Dashboard KPI error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/sales-performance", async (req, res) => {
  try {
    const user = await restrictToOwn(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";

    if (!isAdmin) {
      res.json([]);
      return;
    }

    const allUsers = await db.select().from(usersTable);
    const allContacts = await db.select().from(contactsTable);
    const allDeals = await db.select().from(dealsTable);
    const allActivities = await db.select().from(activitiesTable);

    const result = allUsers.map(u => {
      const userContacts = allContacts.filter(c => c.salesOwnerId === u.id);
      const userDeals = allDeals.filter(d => d.salesOwnerId === u.id);
      const contactIds = new Set(userContacts.map(c => c.id));
      const userActivities = allActivities.filter(a => a.contactId && contactIds.has(a.contactId));

      const totalContacts = userContacts.length;
      const totalDeals = userDeals.length;
      const wonDeals = userDeals.filter(d => d.stage === "Won").length;
      const lostDeals = userDeals.filter(d => d.stage === "Lost").length;
      const activeDeals = userDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length;
      const totalWonValue = userDeals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? d.totalValue ?? 0), 0);
      const myClients = userContacts.filter(c => c.category === "My Client").length;
      const conversionRate = totalContacts > 0 ? Math.round((myClients / totalContacts) * 100) : 0;

      const totalFollowUps = userActivities.filter(a => a.type === "FollowUp").length;
      const completedFollowUps = userActivities.filter(a => a.type === "FollowUp" && a.callStatus === "Completed").length;
      const followUpRate = totalFollowUps > 0 ? Math.round((completedFollowUps / totalFollowUps) * 100) : 0;

      return {
        userId: u.id,
        userName: u.name,
        colorCode: u.colorCode,
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
    const user = await restrictToOwn(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";

    const allContacts = isAdmin
      ? await db.select().from(contactsTable)
      : await db.select().from(contactsTable).where(eq(contactsTable.salesOwnerId, user.id));
    const allDeals = isAdmin
      ? await db.select().from(dealsTable)
      : await db.select().from(dealsTable).where(eq(dealsTable.salesOwnerId, user.id));

    const categoryDistribution = CATEGORIES.map(category => ({
      name: category,
      value: allContacts.filter(c => c.category === category).length,
    }));

    const dealStageDistribution = DEAL_STAGES.map(stage => ({
      stage,
      count: allDeals.filter(d => d.stage === stage).length,
    }));

    const monthlyTrends: { month: string; contacts: number; deals: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const label = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
      monthlyTrends.push({
        month: label,
        contacts: allContacts.filter(c => c.createdAt >= monthStart && c.createdAt < monthEnd).length,
        deals: allDeals.filter(d => d.createdAt >= monthStart && d.createdAt < monthEnd).length,
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
    const user = await restrictToOwn(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = user.role === "admin";

    let activities = await db
      .select()
      .from(activitiesTable)
      .orderBy(activitiesTable.createdAt)
      .limit(50);

    if (!isAdmin) {
      const userContacts = await db
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(eq(contactsTable.salesOwnerId, user.id));
      const userContactIds = new Set(userContacts.map(c => c.id));
      activities = activities.filter(a => a.contactId && userContactIds.has(a.contactId));
    }

    const activityContactIds = [...new Set(activities.map(a => a.contactId).filter(Boolean))] as number[];
    let contacts: (typeof contactsTable.$inferSelect)[] = [];
    if (activityContactIds.length > 0) {
      contacts = await db.select().from(contactsTable).where(inArray(contactsTable.id, activityContactIds));
    }
    const contactMap = new Map(contacts.map(c => [c.id, c]));

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

export default router;
