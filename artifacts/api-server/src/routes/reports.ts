import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, activitiesTable, proformaInvoicesTable, proformaInvoiceItemsTable, DEAL_STAGES, STAGE_PROBS } from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, or, isNull, type SQL } from "drizzle-orm";
import { GetPipelineReportQueryParams, GetReportByOwnerQueryParams, GetReportByProductQueryParams, GetReportByCityQueryParams, GetReportByStateQueryParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";
import { normalizeProfilePhotoUrl } from "../lib/storage";
import { normalizeState, normalizeCity, inferStateFromCity } from "../utils/geoMapping";

const router: IRouter = Router();

function filterContactsByUnit(contacts: any[], unit: string | undefined) {
  if (!unit) return contacts;
  if (unit === PENDING_UNIT_ASSIGNMENT) {
    return contacts.filter(c => !c.unit);
  }
  return contacts.filter(c => c.unit === unit);
}

function filterDealsByUnit(deals: any[], unit: string | undefined, allContacts: any[]) {
  if (!unit) return deals;
  const contactIds = new Set(filterContactsByUnit(allContacts, unit).map(c => c.id));
  return deals.filter(d => contactIds.has(d.contactId));
}

async function getUnitContactIds(unit: string): Promise<Set<number>> {
  if (unit === PENDING_UNIT_ASSIGNMENT) {
    const contacts = await db.select().from(contactsTable).where(isNull(contactsTable.unit));
    return new Set(contacts.map(c => c.id));
  }
  const contacts = await db.select().from(contactsTable).where(eq(contactsTable.unit, unit));
  return new Set(contacts.map(c => c.id));
}

async function restrictToOwnDeals(req: any, params: any) {
  const user = await getUserFromRequest(req);
  if (!user) { return null; }
  if ((user.role === "sales" || user.role === "production_and_support") && !user.canViewAllReports) {
    params.salesOwnerId = user.id;
  }
  return user;
}

function getDateRange(req: any): { startDate: Date | null; endDate: Date | null } {
  const startDateStr = req.query.startDate as string | undefined;
  const endDateStr = req.query.endDate as string | undefined;
  const monthStr = req.query.month as string | undefined;

  if (startDateStr || endDateStr) {
    const startDate = startDateStr ? new Date(startDateStr) : null;
    const endDate = endDateStr ? (() => { const d = new Date(endDateStr); d.setHours(23, 59, 59, 999); return d; })() : null;
    return { startDate, endDate };
  }
  if (monthStr) {
    const [year, month] = monthStr.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }
  return { startDate: null, endDate: null };
}

router.get("/reports/summary", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    let contacts = await db.select().from(contactsTable);
    let deals = await db.select().from(dealsTable);

    // Apply role-based scoping + query filters
    const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
    const requestedUnit = req.query.unit as string | undefined;
    const unitFilter = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;

    if (user && (user.role === "sales" || user.role === "production_and_support") && !user.canViewAllReports) {
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

    const { startDate, endDate } = getDateRange(req);

    // Apply date range filter to deals
    if (startDate || endDate) {
      deals = deals.filter(d => {
        const created = new Date(d.createdAt);
        if (startDate && created < startDate) return false;
        if (endDate && created > endDate) return false;
        return true;
      });
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
    const newLeadsDate = startDate && endDate ? startDate : new Date(monthStart);
    const newLeadsThisMonth = contacts.filter(c => c.createdAt >= newLeadsDate).length;

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        const unitContactIds = await getUnitContactIds(params.data.unit);
        deals = deals.filter(d => unitContactIds.has(d.contactId));
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
        totalValue: stageDeals.reduce((s, d) => s + Number(stage === "Won" ? (d.wonAmount ?? d.totalValue ?? 0) : (d.totalValue ?? 0)), 0),
        probability: STAGE_PROBS[stage] ?? 0,
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Pipeline report error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/reports/by-owner", async (req, res) => {
  try {
    const params = GetReportByOwnerQueryParams.safeParse(req.query);
    const authUser = await getUserFromRequest(req);
    if (!authUser) { res.status(403).json({ error: "Unauthorized" }); return; }
    let deals = await db.select().from(dealsTable);
    if ((authUser.role === "sales" || authUser.role === "production_and_support") && !authUser.canViewAllReports) {
      deals = deals.filter(d => d.salesOwnerId === authUser.id);
    }
    // Apply owner filter from query if admin
    const salesOwnerId = req.query.salesOwnerId ? Number(req.query.salesOwnerId) : undefined;
    if (authUser.role === "admin" && salesOwnerId) {
      deals = deals.filter(d => d.salesOwnerId === salesOwnerId);
    }

    const users = await db.select().from(usersTable);
    // Only include sales users
    let salesUsers = users.filter(u => u.role === "admin" || u.role === "sales" || u.role === "production_and_support");

    if (params.success) {
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        const unitContactIds = await getUnitContactIds(params.data.unit);
        deals = deals.filter(d => unitContactIds.has(d.contactId));
      }
    }

    // Sales/Support users should only see their own performance
    if ((authUser.role === "sales" || authUser.role === "production_and_support") && !authUser.canViewAllReports) {
      salesUsers = salesUsers.filter(u => u.id === authUser.id);
    }

    const result = salesUsers.map(u => {
      const userDeals = deals.filter(d => d.salesOwnerId === u.id);
      return {
        userId: u.id,
        userName: u.name,
        username: u.username,
        colorCode: u.colorCode,
        profilePhoto: normalizeProfilePhotoUrl(u.profilePhoto),
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/reports/by-product", async (req, res) => {
  try {
    const params = GetReportByProductQueryParams.safeParse(req.query);
    const user = await getUserFromRequest(req);
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }

    const conditions: SQL[] = [];

    // Role-based filtering: admins/privileged users can pass a salesOwnerId,
    // everyone else is strictly limited to their own deals.
    const salesOwnerId = params.success && params.data.salesOwnerId
      ? params.data.salesOwnerId
      : undefined;
    if (salesOwnerId) {
      conditions.push(eq(dealsTable.salesOwnerId, salesOwnerId));
    } else if ((user.role === "sales" || user.role === "production_and_support") && !user.canViewAllReports) {
      conditions.push(eq(dealsTable.salesOwnerId, user.id));
    }

    const { startDate, endDate } = getDateRange(req);
    if (startDate) conditions.push(gte(dealsTable.createdAt, startDate));
    if (endDate) conditions.push(lte(dealsTable.createdAt, endDate));

    // Unit isolation: admins/All-unit users may filter by query unit, others are pinned to their unit.
    const requestedUnit = req.query.unit as string | undefined;
    const unitFilter = (user.role === "admin" || user.unit === "All") ? requestedUnit : user.unit;
    if (unitFilter) {
      const unitContactIds = await getUnitContactIds(unitFilter);
      if (unitContactIds.size > 0) {
        conditions.push(inArray(dealsTable.contactId, [...unitContactIds]));
      } else {
        conditions.push(sql`1 = 0`);
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : sql`true`;

    // Aggregate products across both sources where deal products live:
    //   - deal_products (manually attached products)
    //   - proforma_invoice_items (products entered on the deal's proforma invoices)
    // Rows group by MASTER product (product_id), with a `variants` breakdown by
    // weight + colour so weight/colour combinations are individually inspectable.
    const { rows } = await db.execute(sql`
      WITH allowed_deals AS (
        SELECT id FROM deals WHERE ${where}
      ),
      -- Exactly ONE (current) Proforma Invoice per deal: prefer the version the
      -- app marks active (is_active = true, set by deactivateActivePis on each
      -- revision), falling back to the highest id for legacy rows whose flags
      -- were never maintained. Without this, items from BOTH v1 and v2 of a
      -- revised PI get summed here and quantities/values double.
      latest_pi AS (
        SELECT DISTINCT ON (deal_id) deal_id, id
        FROM proforma_invoices
        WHERE deal_id IS NOT NULL
          AND is_deleted = false
          AND deleted_at IS NULL
        ORDER BY deal_id, is_active DESC, id DESC
      ),
      src AS (
        -- First half: deal_products. Only count these for deals that do NOT
        -- have a (non-deleted) Proforma Invoice. Converted deals store their
        -- products in proforma_invoice_items, so counting both tables would
        -- double the quantity/value for the same deal.
        SELECT ad.id AS deal_id, dp.product_id AS product_id,
               coalesce(p.name, 'Unknown') AS product_name,
               p.product_code AS product_code,
               NULL::text AS weight, NULL::text AS colour,
               dp.quantity AS quantity, dp.quantity * coalesce(dp.unit_price, 0) AS value
        FROM deal_products dp
        JOIN allowed_deals ad ON ad.id = dp.deal_id
        LEFT JOIN products p ON p.id = dp.product_id
        WHERE NOT EXISTS (
          SELECT 1 FROM proforma_invoices pi
          WHERE pi.deal_id = dp.deal_id
            AND pi.is_deleted = false
            AND pi.deleted_at IS NULL
        )
        UNION ALL
        SELECT ad.id AS deal_id, pii.product_id AS product_id,
               coalesce(p.name, btrim(pii.product_name)) AS product_name,
               p.product_code AS product_code,
               btrim(pii.weight) AS weight, btrim(pii.bottle_colour) AS colour,
               pii.quantity AS quantity,
               coalesce(pii.amount, pii.quantity * coalesce(pii.rate, 0)) AS value
        FROM proforma_invoice_items pii
        JOIN latest_pi lp ON lp.id = pii.invoice_id
        JOIN allowed_deals ad ON ad.id = lp.deal_id
        LEFT JOIN products p ON p.id = pii.product_id
      )
      SELECT t.product_id AS "productId",
             t.product_name AS "productName",
             t.product_code AS "productCode",
             count(DISTINCT t.deal_id)::int AS "dealCount",
             coalesce(sum(t.quantity), 0)::float AS "totalQuantity",
             coalesce(sum(t.value), 0)::float AS "totalValue",
             coalesce(
               (SELECT jsonb_agg(v.* ORDER BY (v."totalValue") DESC)
                FROM (
                  SELECT s.weight AS "weight", s.colour AS "colour",
                         count(DISTINCT s.deal_id)::int AS "dealCount",
                         coalesce(sum(s.quantity), 0)::float AS "totalQuantity",
                         coalesce(sum(s.value), 0)::float AS "totalValue"
                  FROM src s
                  WHERE s.product_id IS NOT DISTINCT FROM t.product_id
                  GROUP BY s.weight, s.colour
                ) v),
               '[]'::jsonb
             ) AS "variants"
      FROM src t
      GROUP BY t.product_id, t.product_name, t.product_code
      ORDER BY "totalValue" DESC
    `);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "By-product report error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
        lostContacts = lostContacts.filter(c => {
          if (!c.lostDate) return false;
          const lost = new Date(c.lostDate);
          if (startDate && lost < startDate) return false;
          if (endDate && lost > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        const unitContactIds = await getUnitContactIds(params.data.unit);
        deals = deals.filter(d => unitContactIds.has(d.contactId));
        lostContacts = lostContacts.filter(c => unitContactIds.has(c.id));
      }
    }

    const reasonMap = new Map<string, { count: number }>();

    // Count from lost deals
    for (const deal of deals) {
      const reason = deal.lostReason ?? "Not Specified";
      if (!reasonMap.has(reason)) reasonMap.set(reason, { count: 0 });
      const s = reasonMap.get(reason)!;
      s.count++;
    }

    // Count from lost leads (contacts)
    for (const c of lostContacts) {
      const reason = c.lostReason ?? "Not Specified";
      if (!reasonMap.has(reason)) reasonMap.set(reason, { count: 0 });
      const s = reasonMap.get(reason)!;
      s.count++;
    }

    const result = Array.from(reasonMap.entries())
      .map(([reason, s]) => ({ reason, ...s }))
      .sort((a, b) => b.count - a.count);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Lost reasons report error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
        lostContacts = lostContacts.filter(c => {
          if (!c.lostDate) return false;
          const lost = new Date(c.lostDate);
          if (startDate && lost < startDate) return false;
          if (endDate && lost > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        let unitContactIds: Set<number>;
        if (params.data.unit === PENDING_UNIT_ASSIGNMENT) {
          unitContactIds = new Set(allContacts.filter(c => !c.unit || c.unit === PENDING_UNIT_ASSIGNMENT || c.unit.trim() === "").map(c => c.id));
        } else {
          unitContactIds = new Set(allContacts.filter(c => c.unit === params.data.unit).map(c => c.id));
        }
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

    res.json({ success: true, data: records, total: records.length });
  } catch (err) {
    console.error("Lost reason detail error:", err instanceof Error ? err.message : "");
    req.log.error({ err }, "Lost reason detail error");
    res.json({ success: true, data: [], total: 0 });
  }
});

router.get("/reports/stage-detail", async (req, res) => {
  try {
    const stage = req.query.stage as string;
    if (stage !== "Won" && stage !== "Lost") {
      res.status(400).json({ error: "stage query param must be Won or Lost" });
      return;
    }

    const params = GetPipelineReportQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }

    const search = ((req.query.search as string) ?? "").toLowerCase();

    const allUsers = await db.select().from(usersTable);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    let deals = await db.select().from(dealsTable).where(eq(dealsTable.stage, stage));
    const allContacts = await db.select().from(contactsTable);
    const contactMap = new Map(allContacts.map(c => [c.id, c]));

    // Deal products for product info
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

    // Mirror the pipeline report filters so the drill-down matches the table counts
    if (params.success) {
      if (params.data.salesOwnerId) {
        deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      }
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        const unitContactIds = await getUnitContactIds(params.data.unit);
        deals = deals.filter(d => unitContactIds.has(d.contactId));
      }
    }

    const records = deals
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
          notes: d.lostNotes ?? "",
          contactId: d.contactId,
          dealId: d.id,
          dealValue: stage === "Won" ? (d.wonAmount ?? d.totalValue ?? 0) : (d.totalValue ?? 0),
        };
      })
      .filter(r => {
        if (!search) return true;
        return (
          r.customerName.toLowerCase().includes(search) ||
          r.companyName.toLowerCase().includes(search) ||
          r.mobile.includes(search) ||
          r.city.toLowerCase().includes(search) ||
          r.salesPerson.toLowerCase().includes(search) ||
          r.notes.toLowerCase().includes(search)
        );
      });

    res.json({ success: true, data: records, total: records.length });
  } catch (err) {
    console.error("Stage detail error:", err instanceof Error ? err.message : "");
    req.log.error({ err }, "Stage detail error");
    res.json({ success: true, data: [], total: 0 });
  }
});

router.get("/reports/raw-deals", async (req, res) => {
  try {
    const params = GetPipelineReportQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }

    let deals = await db.select().from(dealsTable);
    const allContacts = await db.select().from(contactsTable);
    const contactMap = new Map(allContacts.map(c => [c.id, c]));
    const allUsers = await db.select().from(usersTable);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    // Products (+ per-deal-per-product QUANTITIES) so the "By Product" report
    // can drill down AND the context-aware Detailed Export can group raw deals
    // by product with real quantities. Uses latest_pi so superseded PI versions
    // cannot inject stale names or double the quantities.
    const productMap = new Map<number, Set<string>>();
    const productQtyMap = new Map<number, Map<string, number>>();
    try {
      const { rows: prodRows } = await db.execute(sql`
        WITH latest_pi AS (
          -- One current PI per deal (same rule as /reports/by-product) so
          -- superseded v1 items cannot inject stale product names.
          SELECT DISTINCT ON (deal_id) deal_id, id
          FROM proforma_invoices
          WHERE deal_id IS NOT NULL
            AND is_deleted = false
            AND deleted_at IS NULL
          ORDER BY deal_id, is_active DESC, id DESC
        )
        SELECT dp.deal_id AS "dealId", coalesce(p.name, 'Unknown') AS "productName",
               sum(dp.quantity)::float AS "quantity"
        FROM deal_products dp
        LEFT JOIN products p ON p.id = dp.product_id
        WHERE NOT EXISTS (
          SELECT 1 FROM proforma_invoices pi
          WHERE pi.deal_id = dp.deal_id
            AND pi.is_deleted = false
            AND pi.deleted_at IS NULL
        )
        GROUP BY 1, 2
        UNION ALL
        SELECT lp.deal_id AS "dealId", coalesce(p.name, btrim(pii.product_name)) AS "productName",
               sum(pii.quantity)::float AS "quantity"
        FROM proforma_invoice_items pii
        JOIN latest_pi lp ON lp.id = pii.invoice_id
        LEFT JOIN products p ON p.id = pii.product_id
        GROUP BY 1, 2
      `);
      for (const row of (prodRows ?? []) as any[]) {
        const id = row.dealId;
        if (id == null) continue;
        if (!productMap.has(id)) productMap.set(id, new Set());
        productMap.get(id)!.add(row.productName);
        if (!productQtyMap.has(id)) productQtyMap.set(id, new Map());
        const qm = productQtyMap.get(id)!;
        qm.set(row.productName, (qm.get(row.productName) ?? 0) + Number(row.quantity ?? 0));
      }
    } catch { /* products are optional for the drill-down */ }

    // Mirror the pipeline report filters so the raw rows match the report metrics
    if (params.success) {
      if (params.data.salesOwnerId) {
        deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      }
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
      if (params.data.unit) {
        const unitContactIds = await getUnitContactIds(params.data.unit);
        deals = deals.filter(d => unitContactIds.has(d.contactId));
      }
    }

    const records = deals.map(d => {
      const contact = contactMap.get(d.contactId);
      const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : undefined;
      const state = contact?.state ? normalizeState(contact.state) : null;
      const stateKey = (state ?? (contact?.city ? inferStateFromCity(contact.city) : null)) ?? "Unknown";
      return {
        clientName: contact?.name ?? "Unknown",
        company: contact?.companyName ?? "",
        mobile: contact?.mobile ?? "",
        city: contact?.city ?? "",
        cityName: (contact?.city ? normalizeCity(contact.city) : null) ?? "Unknown",
        state: stateKey,
        dealName: d.title ?? "",
        stage: d.stage,
        value: d.stage === "Won" ? Number(d.wonAmount ?? d.totalValue ?? 0) : Number(d.totalValue ?? 0),
        probability: d.probability ?? "",
        lostReason: d.lostReason ?? "",
        salesPerson: owner?.name ?? "",
        salesOwnerId: d.salesOwnerId ?? null,
        products: [...(productMap.get(d.id) ?? [])],
        productItems: [...(productQtyMap.get(d.id)?.entries() ?? [])]
          .map(([name, quantity]) => ({ name, quantity }))
          .sort((a, b) => b.quantity - a.quantity),
        totalQuantity: [...(productQtyMap.get(d.id)?.values() ?? [])].reduce((s, q) => s + q, 0),
        createdDate: d.createdAt ? new Date(d.createdAt).toISOString() : "",
        contactId: d.contactId,
        dealId: d.id,
      };
    });

    res.json({ success: true, data: records, total: records.length });
  } catch (err) {
    console.error("Raw deals export error:", err instanceof Error ? err.message : "");
    req.log.error({ err }, "Raw deals export error");
    res.json({ success: true, data: [], total: 0 });
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
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
    }

    const cityMap = new Map<string, { totalDeals: number; wonDeals: number; lostDeals: number; totalWonValue: number }>();
    for (const deal of deals) {
      const contact = contactMap.get(deal.contactId);
      const city = (contact?.city ? normalizeCity(contact.city) : null) ?? "Unknown";
      if (!cityMap.has(city)) cityMap.set(city, { totalDeals: 0, wonDeals: 0, lostDeals: 0, totalWonValue: 0 });
      const s = cityMap.get(city)!;
      s.totalDeals++;
      if (deal.stage === "Won") {
        s.wonDeals++;
        s.totalWonValue += Number(deal.wonAmount ?? 0);
      }
      if (deal.stage === "Lost") {
        s.lostDeals++;
      }
    }

    res.json(Array.from(cityMap.entries()).map(([city, s]) => ({ city, ...s })));
  } catch (err) {
    req.log.error({ err }, "By-city report error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/reports/by-state", async (req, res) => {
  try {
    const params = GetReportByStateQueryParams.safeParse(req.query);
    const user = await restrictToOwnDeals(req, params.data ?? {});
    if (!user) { res.status(403).json({ error: "Unauthorized" }); return; }
    let deals = await db.select().from(dealsTable);
    const contacts = await db.select().from(contactsTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    if (params.success) {
      if (params.data.salesOwnerId) deals = deals.filter(d => d.salesOwnerId === params.data.salesOwnerId);
      const { startDate, endDate } = getDateRange(req);
      if (startDate || endDate) {
        deals = deals.filter(d => {
          const created = new Date(d.createdAt);
          if (startDate && created < startDate) return false;
          if (endDate && created > endDate) return false;
          return true;
        });
      }
    }

    const stateMap = new Map<string, { totalDeals: number; wonDeals: number; lostDeals: number; totalWonValue: number }>();
    for (const deal of deals) {
      const contact = contactMap.get(deal.contactId);
      const state = contact?.state ? normalizeState(contact.state) : null;
      const stateKey = (state ?? (contact?.city ? inferStateFromCity(contact.city) : null)) ?? "Unknown";
      if (!stateMap.has(stateKey)) stateMap.set(stateKey, { totalDeals: 0, wonDeals: 0, lostDeals: 0, totalWonValue: 0 });
      const s = stateMap.get(stateKey)!;
      s.totalDeals++;
      if (deal.stage === "Won") {
        s.wonDeals++;
        s.totalWonValue += Number(deal.wonAmount ?? 0);
      }
      if (deal.stage === "Lost") {
        s.lostDeals++;
      }
    }

    res.json({ dealsByState: Array.from(stateMap.entries()).map(([state, s]) => ({ state, ...s })) });
  } catch (err) {
    req.log.error({ err }, "By-state report error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
