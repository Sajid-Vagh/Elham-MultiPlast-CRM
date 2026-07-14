import { Router, type IRouter } from "express";
import {
  db,
  productionOrdersTable,
  productionTimelineTable,
  productionNotesTable,
  proformaInvoicesTable,
  proformaInvoiceItemsTable,
  usersTable,
  contactsTable,
  ordersTable,
  orderItemsTable,
  dealsTable,
  activitiesTable,
} from "@workspace/db";
import { eq, desc, and, SQL, sql, gte, lte, or, inArray } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

// --- Pending Production Requirements (aggregated by product + gramage) ---
router.get("/production/pending-requirements", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const results = await db.execute(sql`
      SELECT
        oi.product_name AS "productName",
        COALESCE(oi.gramage, 'N/A') AS "gramage",
        SUM(oi.quantity::numeric) AS "totalOrdered",
        SUM(oi.dispatched_quantity::numeric) AS "totalDispatched",
        SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric) AS "pending",
        COUNT(DISTINCT oi.order_id) AS "orderCount"
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.is_deleted = false
        AND oi.status NOT IN ('Completed', 'Cancelled', 'Dispatched')
        AND o.status NOT IN ('Cancelled', 'Completed')
      GROUP BY oi.product_name, oi.gramage
      HAVING SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric) > 0
      ORDER BY (SUM(oi.quantity::numeric) - SUM(oi.dispatched_quantity::numeric)) DESC
    `);

    res.json(results.rows || []);
  } catch (err) {
    console.error("Get pending requirements error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Existing production endpoints below ---

const PRODUCTION_STATUSES = [
  "Pending",
  "Material Ready",
  "Production Started",
  "In Process",
  "Quality Check",
  "Packing",
  "Ready For Dispatch",
  "Completed",
  "On Hold",
  "Cancelled",
] as const;

function canAccessProduction(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "production_manager";
}

async function requireProductionUser(req: any, res: any): Promise<any | null> {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!canAccessProduction(user)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

function getAccessibleUnits(user: { role: string; unit?: string | null }): string[] | null {
  if (user.role === "admin") return null;
  const u = user.unit || "All";
  if (u === "All" || u === "Himatnagar") return null;
  return [u];
}

async function enrichProductionOrder(order: any) {
  let invoice: any = null;
  if (order.proformaInvoiceId) {
    const [inv] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
    invoice = inv || null;
  }
  // Fallback 1: if no PI linked but deal exists, fetch latest PI from deal
  if (!invoice && order.dealId) {
    const [inv] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.dealId, order.dealId))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(1);
    invoice = inv || null;
  }
  // Fallback 2: try to find PI by contact from the deal
  if (!invoice && order.dealId) {
    const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, order.dealId));
    if (deal?.contactId) {
      const [inv] = await db
        .select()
        .from(proformaInvoicesTable)
        .where(eq(proformaInvoicesTable.contactId, deal.contactId))
        .orderBy(desc(proformaInvoicesTable.createdAt))
        .limit(1);
      invoice = inv || null;
    }
  }

  const items = invoice
    ? await db
        .select()
        .from(proformaInvoiceItemsTable)
        .where(eq(proformaInvoiceItemsTable.invoiceId, invoice.id))
    : [];

  let contact = null;
  if (invoice?.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, invoice.contactId));
    if (c) contact = c;
  }
  // Fallback: get contact from deal when no invoice found
  if (!contact && order.dealId) {
    const [deal] = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.id, order.dealId));
    if (deal?.contactId) {
      const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (c) contact = c;
    }
  }

  let assignedManager = null;
  if (order.assignedProductionManagerId) {
    const [u] = await db
      .select({ id: usersTable.id, name: usersTable.name, colorCode: usersTable.colorCode })
      .from(usersTable)
      .where(eq(usersTable.id, order.assignedProductionManagerId));
    if (u) assignedManager = u;
  }

  let lastUpdatedBy = null;
  if (order.updatedBy) {
    const [u] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, order.updatedBy));
    if (u) lastUpdatedBy = u;
  }

  const timeline = await db
    .select()
    .from(productionTimelineTable)
    .where(eq(productionTimelineTable.productionOrderId, order.id))
    .orderBy(desc(productionTimelineTable.createdAt));

  const timelineWithUsers = await Promise.all(
    timeline.map(async (t) => {
      let user = null;
      if (t.createdBy) {
        const [u] = await db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, t.createdBy));
        if (u) user = u;
      }
      return { ...t, createdByUser: user };
    })
  );

  const notes = await db
    .select()
    .from(productionNotesTable)
    .where(eq(productionNotesTable.productionOrderId, order.id))
    .orderBy(desc(productionNotesTable.createdAt));

  const notesWithUsers = await Promise.all(
    notes.map(async (n) => {
      let user = null;
      if (n.createdBy) {
        const [u] = await db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, n.createdBy));
        if (u) user = u;
      }
      return { ...n, createdByUser: user };
    })
  );

  return {
    ...order,
    invoice: invoice
      ? {
          ...invoice,
          taxableAmount: Number(invoice.taxableAmount || 0),
          freight: Number(invoice.freight || 0),
          cgst: Number(invoice.cgst || 0),
          sgst: Number(invoice.sgst || 0),
          igst: Number(invoice.igst || 0),
          cgstPercent: Number(invoice.cgstPercent || 0),
          sgstPercent: Number(invoice.sgstPercent || 0),
          igstPercent: Number(invoice.igstPercent || 0),
          grandTotal: Number(invoice.grandTotal || 0),
        }
      : null,
    items: items.map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      amount: Number(i.amount),
      gstPercent: Number(i.gstPercent || 0),
    })),
    contact,
    assignedManager,
    lastUpdatedBy,
    timeline: timelineWithUsers,
    notes: notesWithUsers,
    createdById: order.createdById,
    createdByName: order.createdByName,
    createdByRole: order.createdByRole,
    productionUnit: order.productionUnit,
    productionRemarks: order.productionRemarks,
  };
}

// ── Pending Production Summary (grouped by product) ──
router.get("/production/pending-summary", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const { unit: unitFilter } = req.query as Record<string, string | undefined>;
    const accessibleUnits = getAccessibleUnits(user);
    const unitConditions: SQL[] = [];

    if (unitFilter && unitFilter !== "all") {
      unitConditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
    } else if (accessibleUnits) {
      unitConditions.push(or(
        inArray(productionOrdersTable.productionUnit, accessibleUnits),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }

    const unitWhere = unitConditions.length > 0 ? and(...unitConditions) : undefined;

    const results = await db.execute(sql`
      WITH resolved_invoices AS (
        SELECT
          po.id AS po_id,
          COALESCE(
            po.proforma_invoice_id,
            (SELECT pi2.id FROM proforma_invoices pi2
             JOIN deals d ON d.contact_id = pi2.contact_id
             WHERE d.id = po.deal_id AND pi2.is_deleted = false
             ORDER BY pi2.created_at DESC LIMIT 1)
          ) AS resolved_invoice_id
        FROM production_orders po
        WHERE po.status NOT IN ('Completed', 'Cancelled')
      )
      SELECT
        pii.product_name AS "productName",
        SUM(pii.quantity::numeric) AS "totalQuantity",
        COUNT(DISTINCT ri.po_id) AS "orderCount",
        array_agg(DISTINCT ri.po_id) AS "orderIds"
      FROM resolved_invoices ri
      JOIN proforma_invoices pi ON pi.id = ri.resolved_invoice_id
      JOIN proforma_invoice_items pii ON pii.invoice_id = pi.id
      WHERE ri.resolved_invoice_id IS NOT NULL
        AND pi.is_deleted = false
        ${unitFilter && unitFilter !== "all" ? sql`AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = ri.po_id AND po.production_unit = ${unitFilter})` : sql``}
        ${accessibleUnits && !(unitFilter && unitFilter !== "all") ? sql`AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = ri.po_id AND (po.production_unit IN (${sql.join(accessibleUnits.map(u => sql`${u}`), sql`, `)}) OR po.production_unit IS NULL))` : sql``}
      GROUP BY pii.product_name
      HAVING SUM(pii.quantity::numeric) > 0
      ORDER BY SUM(pii.quantity::numeric) DESC
    `);

    const summary = (results.rows || []).map((r: any) => ({
      productName: r.productName,
      totalPendingQuantity: Number(r.totalQuantity),
      orderCount: Number(r.orderCount),
      orderIds: r.orderIds,
    }));

    const totalPendingProducts = summary.length;
    const totalPendingPieces = summary.reduce((s: number, r: any) => s + r.totalPendingQuantity, 0);

    res.json({ products: summary, totalPendingProducts, totalPendingPieces });
  } catch (err) {
    console.error("Pending production summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Dashboard KPIs ──
router.get("/production/dashboard", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const { unit: unitFilter } = req.query as Record<string, string | undefined>;
    const accessibleUnits = getAccessibleUnits(user);
    const conditions: SQL[] = [];

    // Unit-based access control
    if (accessibleUnits) {
      conditions.push(or(
        inArray(productionOrdersTable.productionUnit, accessibleUnits),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }

    // Explicit unit filter (from UI dropdown)
    if (unitFilter && unitFilter !== "all") {
      conditions.length = 0;
      conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
    }

    const allOrders = await db
      .select()
      .from(productionOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const pendingCount = allOrders.filter((o) => o.status === "Pending").length;
    const materialReadyCount = allOrders.filter((o) => o.status === "Material Ready").length;
    const inProductionCount = allOrders.filter(
      (o) => o.status === "Production Started" || o.status === "In Process"
    ).length;
    const qualityCheckCount = allOrders.filter((o) => o.status === "Quality Check").length;
    const packingCount = allOrders.filter((o) => o.status === "Packing").length;
    const readyForDispatchCount = allOrders.filter((o) => o.status === "Ready For Dispatch").length;

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const completedToday = allOrders.filter((o) => {
      if (o.status !== "Completed") return false;
      const t = o.updatedAt ? new Date(o.updatedAt) : null;
      return t && t >= todayStart;
    }).length;

    const delayedOrders = allOrders.filter((o) => {
      if (o.status === "Completed" || o.status === "Cancelled") return false;
      if (!o.expectedDispatchDate) return false;
      const d = new Date(o.expectedDispatchDate);
      return d < today;
    }).length;

    res.json({
      pendingCount,
      materialReadyCount,
      inProductionCount,
      qualityCheckCount,
      packingCount,
      readyForDispatchCount,
      completedToday,
      delayedOrders,
      totalOrders: allOrders.length,
    });
  } catch (err) {
    req.log.error({ err }, "Production dashboard error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List Production Orders ──
router.get("/production/orders", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const { status, priority, search, dateFrom, dateTo, createdBy, unit: unitFilter, page, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const conditions: SQL[] = [];

    // Unit-based access control
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(or(
        inArray(productionOrdersTable.productionUnit, accessibleUnits),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }

    // Explicit unit filter overrides access control
    if (unitFilter && unitFilter !== "all") {
      conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
    }

    if (status && status !== "all") {
      conditions.push(eq(productionOrdersTable.status, status));
    }
    if (priority && priority !== "all") {
      conditions.push(eq(productionOrdersTable.priority, priority));
    }
    if (createdBy && createdBy !== "all") {
      if (createdBy === "sales") {
        conditions.push(eq(productionOrdersTable.createdByRole, "sales"));
      } else if (createdBy === "support") {
        conditions.push(eq(productionOrdersTable.createdByRole, "support"));
      } else {
        const userId = parseInt(createdBy, 10);
        if (!isNaN(userId)) {
          conditions.push(eq(productionOrdersTable.createdById, userId));
        }
      }
    }
    if (dateFrom) {
      conditions.push(gte(productionOrdersTable.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lte(productionOrdersTable.createdAt, new Date(dateTo + "T23:59:59")));
    }

    // Get all matching production order IDs (with potential search via join)
    let orderIds: number[] = [];
    if (search) {
      const searchLower = search.toLowerCase();
      const matchingInvoices = await db
        .select({ id: proformaInvoicesTable.id })
        .from(proformaInvoicesTable)
        .where(
          or(
            sql`LOWER(${proformaInvoicesTable.customerName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${proformaInvoicesTable.companyName}) LIKE ${`%${searchLower}%`}`,
            sql`${proformaInvoicesTable.invoiceNumber} ILIKE ${`%${search}%`}`,
            sql`${proformaInvoicesTable.mobile} ILIKE ${`%${search}%`}`
          )
        );
      if (matchingInvoices.length === 0) {
        res.json({ data: [], total: 0, page: 1, totalPages: 0 });
        return;
      }
      orderIds = matchingInvoices.map((i) => i.id);
      conditions.push(
        sql`${productionOrdersTable.proformaInvoiceId} IN (${sql.join(orderIds, sql`, `)})`
      );
    }

    const pageNum = Math.max(1, parseInt(page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit || "15", 10) || 15));
    const offset = (pageNum - 1) * pageSize;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(productionOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const orders = await db
      .select()
      .from(productionOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(productionOrdersTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    const enriched = await Promise.all(orders.map(enrichProductionOrder));

    res.json({
      data: enriched,
      total: count,
      page: pageNum,
      totalPages: Math.ceil(count / pageSize),
    });
  } catch (err) {
    req.log.error({ err }, "List production orders error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Single Production Order ──
router.get("/production/orders/:id", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [order] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Production order not found" });
      return;
    }

    res.json(await enrichProductionOrder(order));
  } catch (err) {
    req.log.error({ err }, "Get production order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Production Order by Proforma Invoice ID (for sales view) ──
router.get("/production/by-invoice/:invoiceId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const invoiceId = Number(req.params.invoiceId);
    if (isNaN(invoiceId)) {
      res.status(400).json({ error: "Invalid invoice id" });
      return;
    }

    const [order] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.proformaInvoiceId, invoiceId));

    if (!order) {
      res.json(null);
      return;
    }

    res.json(await enrichProductionOrder(order));
  } catch (err) {
    req.log.error({ err }, "Get production by invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update Production Order Status ──
router.patch("/production/orders/:id/status", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { status, notes } = req.body;
    if (!status || !PRODUCTION_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const [order] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Production order not found" });
      return;
    }

    await db
      .update(productionOrdersTable)
      .set({ status, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(productionOrdersTable.id, id));

    // Record timeline entry
    await db.insert(productionTimelineTable).values({
      productionOrderId: id,
      status: status,
      notes: notes || null,
      createdBy: user.id,
    });

    // Notify the sales user who owns the proforma invoice
    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));

    if (invoice && invoice.createdBy && invoice.createdBy !== user.id) {
      await createNotification({
        userId: invoice.createdBy,
        type: "production_status",
        title: `Production ${status}`,
        message: `Order #${invoice.invoiceNumber} is now: ${status}${notes ? ` - ${notes}` : ""}`,
        link: `/proforma-invoices`,
        relatedId: order.proformaInvoiceId,
        relatedType: "proforma_invoice",
      });
    }

    // Create activity entry for deal timeline
    if (invoice?.dealId) {
      const statusFrom = order.status;
      const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      await db.insert(activitiesTable).values({
        dealId: invoice.dealId,
        contactId: invoice.contactId || null,
        type: "Note",
        notes: `Production Status Changed: ${statusFrom} → ${status}${notes ? `\n${notes}` : ""}\n\nBy: ${user.name}\n${ts}`,
        createdBy: user.id,
      });
    }

    const [updated] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.id, id));

    res.json(await enrichProductionOrder(updated!));
  } catch (err) {
    req.log.error({ err }, "Update production status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Add Production Note ──
router.post("/production/orders/:id/notes", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { note } = req.body;
    if (!note || !note.trim()) {
      res.status(400).json({ error: "Note is required" });
      return;
    }

    const [order] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Production order not found" });
      return;
    }

    const [newNote] = await db
      .insert(productionNotesTable)
      .values({
        productionOrderId: id,
        note: note.trim(),
        createdBy: user.id,
      })
      .returning();

    let createdByUser = null;
    if (user) {
      createdByUser = { id: user.id, name: user.name };
    }

    // Create activity entry for deal timeline
    if (order.proformaInvoiceId) {
      const [inv] = await db.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));
      if (inv?.dealId) {
        const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        await db.insert(activitiesTable).values({
          dealId: inv.dealId,
          contactId: inv.contactId || null,
          type: "Note",
          notes: `Production Note Added\n\n"${note.trim()}"\n\nBy: ${user.name}\n${ts}`,
          createdBy: user.id,
        });
      }
    }

    res.status(201).json({ ...newNote, createdByUser });
  } catch (err) {
    req.log.error({ err }, "Add production note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Production Order by Contact ID (for Lead Detail page) ──
router.get("/production/by-contact/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contact id" }); return; }

    // Find proforma invoices for this contact
    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.contactId, contactId))
      .orderBy(desc(proformaInvoicesTable.createdAt));

    if (invoices.length === 0) { res.json(null); return; }

    const invoiceIds = invoices.map(i => i.id);

    // Find production orders linked to these invoices
    const orders = await db
      .select()
      .from(productionOrdersTable)
      .where(inArray(productionOrdersTable.proformaInvoiceId, invoiceIds))
      .orderBy(desc(productionOrdersTable.createdAt));

    if (orders.length === 0) { res.json(null); return; }

    // Use the most recent production order
    const po = orders[0];

    let lastUpdatedBy = null;
    if (po.updatedBy) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
      if (u) lastUpdatedBy = u;
    }

    let assignedManager = null;
    if (po.assignedProductionManagerId) {
      const [m] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
      if (m) assignedManager = m;
    }

    const timeline = await db
      .select({
        id: productionTimelineTable.id,
        status: productionTimelineTable.status,
        notes: productionTimelineTable.notes,
        createdAt: productionTimelineTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionTimelineTable)
      .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
      .where(eq(productionTimelineTable.productionOrderId, po.id))
      .orderBy(desc(productionTimelineTable.createdAt));

    const notes = await db
      .select({
        id: productionNotesTable.id,
        note: productionNotesTable.note,
        createdAt: productionNotesTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, productionNotesTable.createdBy))
      .where(eq(productionNotesTable.productionOrderId, po.id))
      .orderBy(desc(productionNotesTable.createdAt));

    const [invoice] = invoices;

    res.json({
      id: po.id,
      status: po.status,
      priority: po.priority,
      expectedDispatchDate: po.expectedDispatchDate,
      productionUnit: po.productionUnit,
      productionRemarks: po.productionRemarks,
      updatedAt: po.updatedAt,
      createdAt: po.createdAt,
      lastUpdatedBy,
      assignedManager,
      createdByName: po.createdByName,
      createdByRole: po.createdByRole,
      timeline,
      notes,
      invoiceId: invoice?.id,
      invoiceNumber: invoice?.invoiceNumber,
    });
  } catch (err) {
    console.error("Get production by contact error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Production Reports (with unit + status + date range filters) ──
router.get("/production/reports", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const { unit: unitFilter, status, dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [];

    // Unit-based access control
    const accessibleUnits = getAccessibleUnits(user);
    if (unitFilter && unitFilter !== "all") {
      conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
    } else if (accessibleUnits) {
      conditions.push(or(
        inArray(productionOrdersTable.productionUnit, accessibleUnits),
        sql`${productionOrdersTable.productionUnit} IS NULL`
      )!);
    }

    if (status && status !== "all") {
      conditions.push(eq(productionOrdersTable.status, status));
    }
    if (dateFrom) {
      conditions.push(gte(productionOrdersTable.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lte(productionOrdersTable.createdAt, new Date(dateTo + "T23:59:59")));
    }

    const allOrders = await db
      .select()
      .from(productionOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(productionOrdersTable.createdAt));

    const enriched = await Promise.all(allOrders.map(enrichProductionOrder));

    // Aggregate stats
    const totalOrders = enriched.length;
    const byStatus: Record<string, number> = {};
    const byUnit: Record<string, number> = {};
    for (const o of enriched) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      const u = o.productionUnit || "Unassigned";
      byUnit[u] = (byUnit[u] || 0) + 1;
    }

    res.json({
      data: enriched,
      stats: { totalOrders, byStatus, byUnit },
    });
  } catch (err) {
    req.log.error({ err }, "Production reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Production Progress by Deal ID (for Sales/Support deal detail view) ──
router.get("/production/progress-by-deal/:dealId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const dealId = Number(req.params.dealId);
    if (isNaN(dealId)) { res.status(400).json({ error: "Invalid deal id" }); return; }

    // Find PI for this deal
    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.dealId, dealId))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(1);

    if (!invoice) { res.json(null); return; }

    const [po] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.proformaInvoiceId, invoice.id));

    if (!po) { res.json(null); return; }

    let assignedManager = null;
    if (po.assignedProductionManagerId) {
      const [m] = await db.select().from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
      if (m) {
        const { passwordHash: _, ...safe } = m;
        assignedManager = safe;
      }
    }

    let lastUpdatedBy = null;
    if (po.updatedBy) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
      if (u) lastUpdatedBy = u;
    }

    const timeline = await db
      .select({
        id: productionTimelineTable.id,
        status: productionTimelineTable.status,
        notes: productionTimelineTable.notes,
        createdAt: productionTimelineTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionTimelineTable)
      .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
      .where(eq(productionTimelineTable.productionOrderId, po.id))
      .orderBy(desc(productionTimelineTable.createdAt));

    const notes = await db
      .select({
        id: productionNotesTable.id,
        note: productionNotesTable.note,
        createdAt: productionNotesTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, productionNotesTable.createdBy))
      .where(eq(productionNotesTable.productionOrderId, po.id))
      .orderBy(desc(productionNotesTable.createdAt));

    res.json({
      id: po.id,
      status: po.status,
      priority: po.priority,
      expectedDispatchDate: po.expectedDispatchDate,
      assignedProductionManager: assignedManager,
      productionUnit: po.productionUnit,
      productionRemarks: po.productionRemarks,
      updatedAt: po.updatedAt,
      lastUpdatedBy,
      timeline,
      notes,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (err) {
    req.log.error({ err }, "Get production progress by deal error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
