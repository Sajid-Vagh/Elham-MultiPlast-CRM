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
} from "@workspace/db";
import { eq, desc, and, SQL, sql, gte, lte, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

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

async function enrichProductionOrder(order: any) {
  const [invoice] = await db
    .select()
    .from(proformaInvoicesTable)
    .where(eq(proformaInvoicesTable.id, order.proformaInvoiceId));

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
  };
}

// ── Dashboard KPIs ──
router.get("/production/dashboard", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const allOrders = await db.select().from(productionOrdersTable);

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

    const { status, priority, search, dateFrom, dateTo, page, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const conditions: SQL[] = [];

    if (status && status !== "all") {
      conditions.push(eq(productionOrdersTable.status, status));
    }
    if (priority && priority !== "all") {
      conditions.push(eq(productionOrdersTable.priority, priority));
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

    res.status(201).json({ ...newNote, createdByUser });
  } catch (err) {
    req.log.error({ err }, "Add production note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
