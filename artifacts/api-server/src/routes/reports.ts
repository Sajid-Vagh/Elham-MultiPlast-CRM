import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, activitiesTable, DEAL_STAGES, STAGE_PROBS } from "@workspace/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";
import { GetPipelineReportQueryParams, GetReportByOwnerQueryParams, GetReportByProductQueryParams, GetReportByCityQueryParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function filterContactsByUnit(contacts: any[], unit: string | undefined) {
  if (!unit) return contacts;
  return contacts.filter(c => c.unit === unit);
}

function filterDealsByUnit(deals: any[], unit: string | undefined, allContacts: any[]) {
  if (!unit) return deals;
  const contactIds = new Set(allContacts.filter(c => c.unit === unit).map(c => c.id));
  return deals.filter(d => contactIds.has(d.contactId));
}

async function restrictToOwnDeals(req: any, params: any) {
  const user = await getUserFromRequest(req);
  if (!user) { return null; }
  if (user.role === "sales" && !user.canViewAllReports) {
    params.salesOwnerId = user.id;
  }
  return user;
}

router.get("/reports/summary", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    let contacts = await db.select().from(contactsTable);
    let deals = await db.select().from(dealsTable);

    // Apply role-based scoping + query filters
    const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
    const unitFilter = req.query.unit as string | undefined;

    if (user && user.role === "sales" && !user.canViewAllReports) {
      contacts = contacts.filter(c => c.salesOwnerId === user.id);
      deals = deals.filter(d => d.salesOwnerId === user.id);
    } else if (user?.role === "admin" && ownerId) {
      contacts = contacts.filter(c => c.salesOwnerId === ownerId);
      deals = deals.filter(d => d.salesOwnerId === ownerId);
    }

    if (unitFilter) {
      contacts = filterContactsByUnit(contacts, unitFilter);
      deals = filterDealsByUnit(deals, unitFilter, contacts);
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const today = now.toISOString().split("T")[0]!;

    const totalContacts = contacts.length;
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => d.stage === "Won").length;
    const lostDeals = deals.filter(d => d.stage === "Lost").length;
    const activeDeals = deals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length;
    const totalWonValue = deals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? 0), 0);
    const newLeadsThisMonth = contacts.filter(c => c.createdAt >= new Date(monthStart)).length;

    // Upcoming follow-ups: Regular Follow up category + pending + followUpDate >= today
    const allUpcomingActivities = await db.select().from(activitiesTable).where(gte(activitiesTable.followUpDate, today));
    const upcomingFollowUps = allUpcomingActivities.filter(a => {
      if (a.callStatus === "Completed") return false;
      const contact = contacts.find(c => c.id === a.contactId);
      if (contact) return contact.category === "Regular Follow up";
      if (a.dealId) {
        const deal = deals.find(d => d.id === a.dealId);
        if (deal) {
          const c = contacts.find(cc => cc.id === deal.contactId);
          return c?.category === "Regular Follow up";
        }
      }
      return false;
    }).length;

    res.json({ totalContacts, totalDeals, wonDeals, lostDeals, activeDeals, totalWonValue, upcomingFollowUps, newLeadsThisMonth });
  } catch (err) {
    req.log.error({ err }, "Report summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/pipeline", async (req, res) => {
  try {
    const params = GetPipelineReportQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }
    let deals = await db.select().from(dealsTable);

    if (params.success) {
      if (params.data.salesOwnerId) deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      if (params.data.month) {
        const [year, month] = params.data.month.split("-").map(Number);
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
        }
      }
      if (params.data.unit) {
        const contacts = await db.select().from(contactsTable).where(eq(contactsTable.unit, params.data.unit));
        const contactIds = new Set(contacts.map(c => c.id));
        deals = deals.filter(d => contactIds.has(d.contactId));
      }
      if (params.data.city) {
        const contacts = await db.select().from(contactsTable);
        const cityContacts = new Set(contacts.filter(c => c.city?.toLowerCase().includes(params.data.city!.toLowerCase())).map(c => c.id));
        deals = deals.filter(d => cityContacts.has(d.contactId));
      }
    }

    const result = DEAL_STAGES.map(stage => {
      const stageDeals = deals.filter(d => d.stage === stage);
      return {
        stage,
        count: stageDeals.length,
        totalValue: stageDeals.reduce((s, d) => s + Number(d.totalValue ?? 0), 0),
        probability: STAGE_PROBS[stage] ?? 0,
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Pipeline report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/by-owner", async (req, res) => {
  try {
    const params = GetReportByOwnerQueryParams.safeParse(req.query);
    const authUser = await getUserFromRequest(req);
    if (!authUser) { res.status(403).json({ error: "Unauthorized" }); return; }
    let deals = await db.select().from(dealsTable);
    if (authUser.role === "sales" && !authUser.canViewAllReports) {
      deals = deals.filter(d => d.salesOwnerId === authUser.id);
    }
    // Apply owner filter from query if admin
    const salesOwnerId = req.query.salesOwnerId ? Number(req.query.salesOwnerId) : undefined;
    if (authUser.role === "admin" && salesOwnerId) {
      deals = deals.filter(d => d.salesOwnerId === salesOwnerId);
    }

    const users = await db.select().from(usersTable);
    // Only include sales users
    let salesUsers = users.filter(u => u.role === "admin" || u.role === "sales");

    if (params.success) {
      if (params.data.month) {
        const [year, month] = params.data.month.split("-").map(Number);
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
        }
      }
      if (params.data.unit) {
        const contacts = await db.select().from(contactsTable).where(eq(contactsTable.unit, params.data.unit));
        const contactIds = new Set(contacts.map(c => c.id));
        deals = deals.filter(d => contactIds.has(d.contactId));
      }
    }

    // Sales users should only see their own performance
    if (authUser.role === "sales" && !authUser.canViewAllReports) {
      salesUsers = salesUsers.filter(u => u.id === authUser.id);
    }

    const result = salesUsers.map(u => {
      const userDeals = deals.filter(d => d.salesOwnerId === u.id);
      return {
        userId: u.id,
        userName: u.name,
        username: u.username,
        colorCode: u.colorCode,
        profilePhoto: u.profilePhoto,
        totalDeals: userDeals.length,
        wonDeals: userDeals.filter(d => d.stage === "Won").length,
        lostDeals: userDeals.filter(d => d.stage === "Lost").length,
        activeDeals: userDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").length,
        totalWonValue: userDeals.filter(d => d.stage === "Won").reduce((s, d) => s + Number(d.wonAmount ?? 0), 0),
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "By-owner report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/by-product", async (req, res) => {
  try {
    const params = GetReportByProductQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }
    let dealProducts = await db.select().from(dealProductsTable);
    let deals = await db.select().from(dealsTable);

    if (params.success) {
      if (params.data.salesOwnerId) deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      if (params.data.month) {
        const [year, month] = params.data.month.split("-").map(Number);
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
        }
      }
    }

    const dealIds = new Set(deals.map(d => d.id));
    dealProducts = dealProducts.filter(dp => dealIds.has(dp.dealId));

    const products = await db.select().from(productsTable);
    const productMap = new Map(products.map(p => [p.id, p]));

    const statsMap = new Map<number, { totalQuantity: number; totalValue: number; dealCount: Set<number> }>();
    for (const dp of dealProducts) {
      if (!statsMap.has(dp.productId)) statsMap.set(dp.productId, { totalQuantity: 0, totalValue: 0, dealCount: new Set() });
      const s = statsMap.get(dp.productId)!;
      s.totalQuantity += Number(dp.quantity);
      s.totalValue += Number(dp.quantity) * Number(dp.unitPrice ?? 0);
      s.dealCount.add(dp.dealId);
    }

    const result = Array.from(statsMap.entries()).map(([productId, s]) => {
      const p = productMap.get(productId);
      return {
        productId,
        productName: p?.name ?? "Unknown",
        productCode: p?.productCode ?? "",
        totalQuantity: s.totalQuantity,
        totalValue: s.totalValue,
        dealCount: s.dealCount.size,
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "By-product report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/lost-reasons", async (req, res) => {
  try {
    const params = GetPipelineReportQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }

    // Collect lost reasons from both deals and contacts
    let deals = await db.select().from(dealsTable).where(eq(dealsTable.stage, "Lost"));
    let lostContacts = await db.select().from(contactsTable).where(
      sql`${contactsTable.lostReason} IS NOT NULL`
    );

    if (params.success) {
      if (params.data.salesOwnerId) {
        deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
        lostContacts = lostContacts.filter(c => c.salesOwnerId === params.data.salesOwnerId);
      }
      if (params.data.month) {
        const [year, month] = params.data.month.split("-").map(Number);
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
          lostContacts = lostContacts.filter(c => c.lostDate && c.lostDate >= start && c.lostDate < end);
        }
      }
      if (params.data.unit) {
        const contacts = await db.select().from(contactsTable).where(eq(contactsTable.unit, params.data.unit));
        const contactIds = new Set(contacts.map(c => c.id));
        deals = deals.filter(d => contactIds.has(d.contactId));
        lostContacts = lostContacts.filter(c => contactIds.has(c.id));
      }
    }

    const reasonMap = new Map<string, { count: number; totalValue: number }>();

    // Count from lost deals
    for (const deal of deals) {
      const reason = deal.lostReason ?? "Not Specified";
      if (!reasonMap.has(reason)) reasonMap.set(reason, { count: 0, totalValue: 0 });
      const s = reasonMap.get(reason)!;
      s.count++;
      s.totalValue += Number(deal.wonAmount ?? 0);
    }

    // Count from lost leads (contacts)
    for (const c of lostContacts) {
      const reason = c.lostReason ?? "Not Specified";
      if (!reasonMap.has(reason)) reasonMap.set(reason, { count: 0, totalValue: 0 });
      const s = reasonMap.get(reason)!;
      s.count++;
      // Lost leads have no monetary value associated
    }

    const result = Array.from(reasonMap.entries())
      .map(([reason, s]) => ({ reason, ...s }))
      .sort((a, b) => b.count - a.count);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Lost reasons report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/lost-reasons/detail", async (req, res) => {
  try {
    const reason = req.query.reason as string;
    if (!reason) { res.status(400).json({ error: "reason query param is required" }); return; }

    const params = GetPipelineReportQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }

    const search = ((req.query.search as string) ?? "").toLowerCase();

    const allUsers = await db.select().from(usersTable);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    // Fetch data
    let deals = await db.select().from(dealsTable).where(eq(dealsTable.stage, "Lost"));
    let allContacts = await db.select().from(contactsTable);
    const contactMap = new Map(allContacts.map(c => [c.id, c]));
    let lostContacts = allContacts.filter(c => c.lostReason !== null);

    // Fetch deal products for product info
    const dealIds = deals.map(d => d.id);
    const dealProductRows = dealIds.length > 0
      ? await db.select().from(dealProductsTable).where(inArray(dealProductsTable.dealId, dealIds))
      : [];
    const productIds = [...new Set(dealProductRows.map(dp => dp.productId))];
    const productRows = productIds.length > 0
      ? await db.select().from(productsTable).where(inArray(productsTable.id, productIds))
      : [];
    const productNameMap = new Map(productRows.map(p => [p.id, p.name]));
    const dealProductMap = new Map<number, string>();
    for (const dp of dealProductRows) {
      const name = productNameMap.get(dp.productId);
      if (name && !dealProductMap.has(dp.dealId)) dealProductMap.set(dp.dealId, name);
    }

    if (params.success) {
      if (params.data.salesOwnerId) {
        deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
        lostContacts = lostContacts.filter(c => c.salesOwnerId === params.data.salesOwnerId);
      }
      if (params.data.month) {
        const [y, m] = params.data.month.split("-").map(Number);
        if (y && m) {
          const start = new Date(y, m - 1, 1);
          const end = new Date(y, m, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
          lostContacts = lostContacts.filter(c => c.lostDate && new Date(c.lostDate) >= start && new Date(c.lostDate) < end);
        }
      }
      if (params.data.unit) {
        const unitContactIds = new Set(allContacts.filter(c => c.unit === params.data.unit).map(c => c.id));
        deals = deals.filter(d => unitContactIds.has(d.contactId));
        lostContacts = lostContacts.filter(c => unitContactIds.has(c.id));
      }
    }

    // Build records
    const dealRecords = deals
      .filter(d => (d.lostReason ?? "Not Specified") === reason)
      .map(d => {
        const contact = contactMap.get(d.contactId);
        const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : undefined;
        return {
          id: d.id,
          type: "deal" as const,
          customerName: contact?.name ?? "Unknown",
          companyName: contact?.companyName ?? "",
          mobile: contact?.mobile ?? "",
          city: contact?.city ?? "",
          salesPerson: owner?.name ?? "",
          unit: contact?.unit ?? "",
          product: dealProductMap.get(d.id) ?? "",
          lostDate: d.updatedAt ? new Date(d.updatedAt).toISOString() : "",
          lostReason: d.lostReason ?? "",
          notes: d.otherReason ?? d.lostNotes ?? "",
          dealValue: Number(d.wonAmount ?? d.totalValue ?? 0),
          contactId: d.contactId,
          dealId: d.id,
        };
      });

    const contactRecords = lostContacts
      .filter(c => c.lostReason === reason)
      .map(c => {
        const owner = c.salesOwnerId ? userMap.get(c.salesOwnerId) : undefined;
        return {
          id: c.id,
          type: "lead" as const,
          customerName: c.name,
          companyName: c.companyName ?? "",
          mobile: c.mobile,
          city: c.city ?? "",
          salesPerson: owner?.name ?? "",
          unit: c.unit ?? "",
          product: "",
          lostDate: c.lostDate ? new Date(c.lostDate).toISOString() : "",
          lostReason: c.lostReason ?? "",
          notes: c.otherReason ?? c.lostNotes ?? "",
          dealValue: 0,
          contactId: c.id,
          dealId: null,
        };
      });

    let records: any[] = [...dealRecords, ...contactRecords];

    if (search) {
      records = records.filter(r =>
        r.customerName.toLowerCase().includes(search) ||
        r.companyName.toLowerCase().includes(search) ||
        r.mobile.includes(search) ||
        r.city.toLowerCase().includes(search) ||
        r.salesPerson.toLowerCase().includes(search) ||
        r.notes.toLowerCase().includes(search)
      );
    }

    const totalValue = records.reduce((s: number, r: any) => s + r.dealValue, 0);

    res.json({ success: true, data: records, total: records.length, totalValue });
  } catch (err) {
    console.error("Lost reason detail error:", err instanceof Error ? err.message : err);
    req.log.error({ err }, "Lost reason detail error");
    res.json({ success: true, data: [], total: 0, totalValue: 0 });
  }
});

router.get("/reports/by-city", async (req, res) => {
  try {
    const params = GetReportByCityQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }
    let deals = await db.select().from(dealsTable);
    const contacts = await db.select().from(contactsTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    if (params.success) {
      if (params.data.salesOwnerId) deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      if (params.data.month) {
        const [year, month] = params.data.month.split("-").map(Number);
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 1);
          deals = deals.filter(d => d.createdAt >= start && d.createdAt < end);
        }
      }
    }

    const cityMap = new Map<string, { totalDeals: number; wonDeals: number; lostDeals: number; totalWonValue: number; totalLostValue: number }>();
    for (const deal of deals) {
      const contact = contactMap.get(deal.contactId);
      const city = contact?.city ?? "Unknown";
      if (!cityMap.has(city)) cityMap.set(city, { totalDeals: 0, wonDeals: 0, lostDeals: 0, totalWonValue: 0, totalLostValue: 0 });
      const s = cityMap.get(city)!;
      s.totalDeals++;
      if (deal.stage === "Won") {
        s.wonDeals++;
        s.totalWonValue += Number(deal.wonAmount ?? 0);
      }
      if (deal.stage === "Lost") {
        s.lostDeals++;
        s.totalLostValue += Number(deal.wonAmount ?? 0);
      }
    }

    res.json(Array.from(cityMap.entries()).map(([city, s]) => ({ city, ...s })));
  } catch (err) {
    req.log.error({ err }, "By-city report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
