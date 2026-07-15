import { Router, type IRouter } from "express";
import {
  db, existingCustomersTable, contactsTable, ordersTable, orderItemsTable,
  usersTable, complaintsTable, orderTimelineTable, customerCommunicationsTable,
  internalNotesTable, activitiesTable, dealProductsTable, dealsTable,
} from "@workspace/db";
import { eq, and, or, ilike, desc, sql, inArray, isNull, asc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";
import { getAccessibleUnits } from "../lib/unit-filter";

const router: IRouter = Router();

// ── Helper: enforce unit-based access on existing customer ──
async function enforceExistingCustomerAccess(
  req: any,
  res: any,
  ecId: number
): Promise<any | null> {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const [ec] = await db
    .select()
    .from(existingCustomersTable)
    .where(eq(existingCustomersTable.id, ecId));
  if (!ec) {
    res.status(404).json({ error: "Not found" });
    return null;
  }

  // Sales can only see their own
  if (user.role === "sales" && ec.salesOwnerId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  // Unit-based access control
  const accessibleUnits = getAccessibleUnits(user);
  if (accessibleUnits) {
    const [contact] = await db
      .select({ unit: contactsTable.unit })
      .from(contactsTable)
      .where(eq(contactsTable.id, ec.contactId))
      .limit(1);
    if (!contact || !accessibleUnits.includes(contact.unit ?? "All")) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
  }

  return { user, ec };
}

// ── Helper: promote contact to existing customer ──
export async function promoteToExistingCustomer(order: typeof ordersTable.$inferSelect) {
  const existing = await db.select().from(existingCustomersTable)
    .where(eq(existingCustomersTable.contactId, order.contactId)).then(r => r[0]);
  if (existing) return existing;

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const lastProduct = items.length > 0 ? items[0].productName : null;

  const [record] = await db.insert(existingCustomersTable).values({
    contactId: order.contactId,
    salesOwnerId: order.salesOwnerId || order.createdBy,
    firstOrderId: order.id,
    lastOrderId: order.id,
    totalOrders: 1,
    repeatOrderCount: 0,
    firstOrderDate: order.createdAt ? new Date(order.createdAt).toISOString().split("T")[0] : null,
    lastOrderDate: order.createdAt ? new Date(order.createdAt).toISOString().split("T")[0] : null,
    lastProductName: lastProduct,
    status: "Active",
    totalRevenue: String(order.grandTotal || 0),
    firstOrderAt: order.createdAt,
    lastOrderAt: order.createdAt,
    isActive: true,
  }).returning();
  return record;
}

// ── Helper: promote deal-won contact to existing customer (no order required) ──
export async function promoteDealToExistingCustomer(contactId: number, salesOwnerId: number) {
  const existing = await db.select().from(existingCustomersTable)
    .where(eq(existingCustomersTable.contactId, contactId)).then(r => r[0]);
  if (existing) return existing;

  const now = new Date();
  const [record] = await db.insert(existingCustomersTable).values({
    contactId,
    salesOwnerId,
    totalOrders: 0,
    repeatOrderCount: 0,
    status: "Active",
    totalRevenue: "0",
    isActive: true,
  }).returning();
  return record;
}

// ── Helper: refresh existing customer stats from orders ──
async function refreshExistingCustomerStats(contactId: number) {
  const ec = await db.select().from(existingCustomersTable).where(eq(existingCustomersTable.contactId, contactId)).then(r => r[0]);
  if (!ec) return;

  const allOrders = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.contactId, contactId), eq(ordersTable.isDeleted, false)))
    .orderBy(desc(ordersTable.createdAt));

  const totalOrders = allOrders.length;
  const repeatOrders = allOrders.filter(o => o.isRepeatOrder).length;
  const lastOrder = allOrders[0] || null;
  const totalRevenue = allOrders.reduce((sum, o) => sum + Number(o.grandTotal || 0), 0);

  const lastItems = lastOrder ? await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, lastOrder.id)) : [];
  const lastProductName = lastItems.length > 0 ? lastItems[0].productName : ec.lastProductName;

  // Check for active complaints
  const [activeComplaint] = await db.select().from(complaintsTable)
    .where(and(eq(complaintsTable.contactId, contactId), eq(complaintsTable.isDeleted, false), or(
      eq(complaintsTable.status, "Open"), eq(complaintsTable.status, "Assigned"),
      eq(complaintsTable.status, "Investigation"), eq(complaintsTable.status, "Production Review"),
      eq(complaintsTable.status, "Replacement Approved"), eq(complaintsTable.status, "Replacement Running"),
    )))
    .orderBy(desc(complaintsTable.createdAt)).limit(1);

  // Check current production/dispatch status from latest order
  let currentProductionStatus: string | null = null;
  let currentDispatchStatus: string | null = null;
  if (lastOrder) {
    const prodStatuses = ["Production Pending", "Production Started", "Production Running", "Quality Check"];
    const dispStatuses = ["Ready for Dispatch", "Partially Dispatched", "Dispatched", "In Transit"];
    if (prodStatuses.includes(lastOrder.status)) currentProductionStatus = lastOrder.status;
    if (dispStatuses.includes(lastOrder.status)) currentDispatchStatus = lastOrder.status;
  }

  // Determine composite status
  let status = "Active";
  if (activeComplaint) status = "Complaint Open";
  else if (currentProductionStatus) status = "Production Running";
  else if (currentDispatchStatus) status = "Dispatch Pending";
  else if (totalOrders > 1 && lastOrder) {
    const daysSinceLast = Math.floor((Date.now() - new Date(lastOrder.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceLast > 60) status = "Repeat Order Due";
  }
  if (!ec.isActive) status = "Inactive";

  await db.update(existingCustomersTable).set({
    lastOrderId: lastOrder?.id || null,
    totalOrders,
    repeatOrderCount: repeatOrders,
    lastOrderDate: lastOrder ? new Date(lastOrder.createdAt).toISOString().split("T")[0] : ec.lastOrderDate,
    lastProductName,
    totalRevenue: String(totalRevenue),
    lastOrderAt: lastOrder?.createdAt || null,
    activeComplaintId: activeComplaint?.id || null,
    activeComplaintNumber: activeComplaint?.complaintNumber || null,
    currentProductionStatus,
    currentDispatchStatus,
    status,
    updatedAt: new Date(),
  }).where(eq(existingCustomersTable.contactId, contactId));
}

// ── Helper: enrich existing customer ──
async function enrichExistingCustomer(ec: any) {
  const contact = ec.contactId ? await db.select().from(contactsTable).where(eq(contactsTable.id, ec.contactId)).then(r => r[0]) : null;
  const salesOwner = ec.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, ec.salesOwnerId)).then(r => r[0]) : null;
  const supportOwner = ec.supportOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, ec.supportOwnerId)).then(r => r[0]) : null;
  const lastOrder = ec.lastOrderId ? await db.select().from(ordersTable).where(eq(ordersTable.id, ec.lastOrderId)).then(r => r[0]) : null;
  const firstOrder = ec.firstOrderId ? await db.select().from(ordersTable).where(eq(ordersTable.id, ec.firstOrderId)).then(r => r[0]) : null;

  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;

  return {
    ...ec,
    contact: contact ? { id: contact.id, name: contact.name, mobile: contact.mobile, email: contact.email, companyName: contact.companyName, city: contact.city, state: contact.state, address: contact.address, gstNumber: (contact as any).gstNumber || null } : null,
    salesOwner: safe(salesOwner),
    supportOwner: safe(supportOwner),
    lastOrder: lastOrder ? { id: lastOrder.id, orderNumber: lastOrder.orderNumber, grandTotal: lastOrder.grandTotal, status: lastOrder.status, createdAt: lastOrder.createdAt, freight: lastOrder.freight, paymentTerms: lastOrder.paymentTerms, deliveryTerms: lastOrder.deliveryTerms, dispatchAddress: lastOrder.dispatchAddress, transportDetails: lastOrder.transportDetails } : null,
    firstOrder: firstOrder ? { id: firstOrder.id, orderNumber: firstOrder.orderNumber, createdAt: firstOrder.createdAt } : null,
  };
}

// ── Dashboard KPIs ──
router.get("/existing-customers/dashboard", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const conditions: any[] = [eq(existingCustomersTable.isActive, true)];
    if (user.role === "sales") conditions.push(eq(existingCustomersTable.salesOwnerId, user.id));

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = ${existingCustomersTable.contactId} AND c.unit IN (${sql.join(accessibleUnits.map(u => sql`${u}`), sql`, `)})
      )`);
    }

    const all = await db.select().from(existingCustomersTable).where(and(...conditions));

    const today = new Date().toISOString().split("T")[0];
    const totalCustomers = all.length;
    const activeCustomers = all.filter(c => c.status !== "Inactive").length;
    const productionRunning = all.filter(c => c.status === "Production Running").length;
    const dispatchPending = all.filter(c => c.status === "Dispatch Pending").length;
    const complaintPending = all.filter(c => c.status === "Complaint Open").length;
    const repeatOrderDue = all.filter(c => c.status === "Repeat Order Due" || (c.repeatOrderDueDate && c.repeatOrderDueDate <= today)).length;
    const inactiveCustomers = all.filter(c => c.status === "Inactive").length;

    // Count customers with follow-ups due today
    const contactsToday = all.map(c => c.contactId);
    let customersToCallToday = 0;
    if (contactsToday.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const [callResult] = await db.select({ count: sql<number>`count(*)::int` })
        .from(activitiesTable)
        .where(and(
          inArray(activitiesTable.contactId, contactsToday),
          eq(activitiesTable.followUpDate, today),
          eq(activitiesTable.callStatus, "Pending"),
        ));
      customersToCallToday = callResult?.count ?? 0;
    }

    res.json({
      totalCustomers,
      activeCustomers,
      productionRunning,
      dispatchPending,
      complaintPending,
      repeatOrderDue,
      inactiveCustomers,
      customersToCallToday,
    });
  } catch (err) {
    console.error("Existing customers dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List existing customers ──
router.get("/existing-customers", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, status, salesOwner, city, productionStatus, dispatchStatus, complaintStatus, lastOrderBefore, lastOrderAfter, repeatOrderDue, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (user.role === "sales") conditions.push(eq(existingCustomersTable.salesOwnerId, user.id));

    if (status && status !== "All") conditions.push(eq(existingCustomersTable.status, status));
    if (salesOwner && (user.role === "admin" || user.role === "production_and_support")) conditions.push(eq(existingCustomersTable.salesOwnerId, Number(salesOwner)));
    if (productionStatus) conditions.push(eq(existingCustomersTable.currentProductionStatus, productionStatus));
    if (dispatchStatus) conditions.push(eq(existingCustomersTable.currentDispatchStatus, dispatchStatus));
    if (complaintStatus === "Open") conditions.push(eq(existingCustomersTable.status, "Complaint Open"));
    if (repeatOrderDue === "true") {
      const today = new Date().toISOString().split("T")[0];
      conditions.push(or(
        eq(existingCustomersTable.status, "Repeat Order Due"),
        and(existingCustomersTable.repeatOrderDueDate, sql`${existingCustomersTable.repeatOrderDueDate} <= ${today}`),
      )!);
    }

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM contacts c WHERE c.id = ${existingCustomersTable.contactId} AND c.unit IN (${sql.join(accessibleUnits.map(u => sql`${u}`), sql`, `)})
      )`);
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(existingCustomersTable).where(conditions.length ? and(...conditions) : undefined);

    let customers = await db.select().from(existingCustomersTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(existingCustomersTable.createdAt)).limit(limitNum).offset(offset);

    // Enrich all customers
    let enriched = await Promise.all(customers.map(enrichExistingCustomer));

    // Post-enrichment filters (contact fields)
    if (search) {
      const s = search.toLowerCase();
      enriched = enriched.filter(c =>
        c.contact?.name?.toLowerCase().includes(s) ||
        c.contact?.companyName?.toLowerCase().includes(s) ||
        c.contact?.mobile?.toLowerCase().includes(s) ||
        c.contact?.email?.toLowerCase().includes(s) ||
        c.contact?.city?.toLowerCase().includes(s) ||
        c.contact?.gstNumber?.toLowerCase().includes(s) ||
        c.salesOwner?.name?.toLowerCase().includes(s) ||
        c.supportOwner?.name?.toLowerCase().includes(s) ||
        c.lastProductName?.toLowerCase().includes(s) ||
        c.lastOrder?.orderNumber?.toLowerCase().includes(s)
      );
    }
    if (city) enriched = enriched.filter(c => c.contact?.city?.toLowerCase() === city.toLowerCase());
    if (lastOrderBefore) enriched = enriched.filter(c => c.lastOrderDate && c.lastOrderDate <= lastOrderBefore);
    if (lastOrderAfter) enriched = enriched.filter(c => c.lastOrderDate && c.lastOrderDate >= lastOrderAfter);

    res.json({
      data: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.count ?? 0,
        totalPages: Math.ceil((countResult?.count ?? 0) / limitNum),
      },
    });
  } catch (err) {
    console.error("List existing customers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get single existing customer ──
router.get("/existing-customers/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [ec] = await db.select().from(existingCustomersTable).where(eq(existingCustomersTable.id, id));
    if (!ec) { res.status(404).json({ error: "Not found" }); return; }

    // Sales can only see their own
    if (user.role === "sales" && ec.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Unit-based access control
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, ec.contactId)).limit(1);
      if (!contact || !accessibleUnits.includes(contact.unit ?? "All")) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    res.json(await enrichExistingCustomer(ec));
  } catch (err) {
    console.error("Get existing customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get order history for existing customer ──
router.get("/existing-customers/:id/orders", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const orders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.contactId, ec.contactId), eq(ordersTable.isDeleted, false)))
      .orderBy(desc(ordersTable.createdAt));

    const enriched = await Promise.all(orders.map(async (order) => {
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      const salesOwner = order.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, order.salesOwnerId)).then(r => r[0]) : null;
      const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;
      return { ...order, items, salesOwner: safe(salesOwner) };
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Get existing customer orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get communications for existing customer ──
router.get("/existing-customers/:id/communications", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const comms = await db.select({
      id: customerCommunicationsTable.id,
      type: customerCommunicationsTable.type,
      direction: customerCommunicationsTable.direction,
      notes: customerCommunicationsTable.notes,
      nextAction: customerCommunicationsTable.nextAction,
      nextActionDate: customerCommunicationsTable.nextActionDate,
      department: customerCommunicationsTable.department,
      createdBy: usersTable.name,
      createdAt: customerCommunicationsTable.createdAt,
    }).from(customerCommunicationsTable)
      .leftJoin(usersTable, eq(usersTable.id, customerCommunicationsTable.createdBy))
      .where(eq(customerCommunicationsTable.contactId, ec.contactId))
      .orderBy(desc(customerCommunicationsTable.createdAt));

    res.json(comms);
  } catch (err) {
    console.error("Get existing customer communications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Log communication for existing customer ──
router.post("/existing-customers/:id/communications", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { user, ec } = access;

    const [comm] = await db.insert(customerCommunicationsTable).values({
      contactId: ec.contactId,
      type: req.body.type,
      direction: req.body.direction || "Outbound",
      notes: req.body.notes,
      nextAction: req.body.nextAction,
      nextActionDate: req.body.nextActionDate,
      department: user.role,
      createdBy: user.id,
    }).returning();

    res.status(201).json(comm);
  } catch (err) {
    console.error("Create communication error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get notes for existing customer ──
router.get("/existing-customers/:id/notes", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const notes = await db.select({
      id: internalNotesTable.id,
      note: internalNotesTable.note,
      department: internalNotesTable.department,
      isPinned: internalNotesTable.isPinned,
      isResolved: internalNotesTable.isResolved,
      createdBy: usersTable.name,
      createdAt: internalNotesTable.createdAt,
    }).from(internalNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, internalNotesTable.createdBy))
      .where(eq(internalNotesTable.contactId, ec.contactId))
      .orderBy(desc(internalNotesTable.isPinned), desc(internalNotesTable.createdAt));

    res.json(notes);
  } catch (err) {
    console.error("Get existing customer notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Add note for existing customer ──
router.post("/existing-customers/:id/notes", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { user, ec } = access;

    const [note] = await db.insert(internalNotesTable).values({
      contactId: ec.contactId,
      note: req.body.note,
      department: user.role,
      isPinned: req.body.isPinned || false,
      createdBy: user.id,
    }).returning();

    res.status(201).json(note);
  } catch (err) {
    console.error("Create note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update existing customer (support owner, status, repeat order due date) ──
router.patch("/existing-customers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;

    const updateFields: any = { updatedAt: new Date() };
    if (req.body.supportOwnerId !== undefined) updateFields.supportOwnerId = req.body.supportOwnerId;
    if (req.body.status !== undefined) updateFields.status = req.body.status;
    if (req.body.repeatOrderDueDate !== undefined) updateFields.repeatOrderDueDate = req.body.repeatOrderDueDate;
    if (req.body.isActive !== undefined) updateFields.isActive = req.body.isActive;

    const [updated] = await db.update(existingCustomersTable).set(updateFields)
      .where(eq(existingCustomersTable.id, id)).returning();

    res.json(await enrichExistingCustomer(updated));
  } catch (err) {
    console.error("Update existing customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get complaint history for existing customer ──
router.get("/existing-customers/:id/complaints", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const complaints = await db.select({
      id: complaintsTable.id,
      complaintNumber: complaintsTable.complaintNumber,
      customerName: complaintsTable.customerName,
      productName: complaintsTable.productName,
      complaintType: complaintsTable.complaintType,
      description: complaintsTable.description,
      priority: complaintsTable.priority,
      status: complaintsTable.status,
      assignedTo: usersTable.name,
      createdAt: complaintsTable.createdAt,
      updatedAt: complaintsTable.updatedAt,
    }).from(complaintsTable)
      .leftJoin(usersTable, eq(usersTable.id, complaintsTable.assignedTo))
      .where(and(eq(complaintsTable.contactId, ec.contactId), eq(complaintsTable.isDeleted, false)))
      .orderBy(desc(complaintsTable.createdAt));

    res.json(complaints);
  } catch (err) {
    console.error("Get existing customer complaints error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get repeat orders for existing customer ──
router.get("/existing-customers/:id/repeat-orders", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const repeatOrders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.contactId, ec.contactId), eq(ordersTable.isDeleted, false), eq(ordersTable.isRepeatOrder, true)))
      .orderBy(desc(ordersTable.createdAt));

    const enriched = await Promise.all(repeatOrders.map(async (order) => {
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      const salesOwner = order.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, order.salesOwnerId)).then(r => r[0]) : null;
      const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;
      return { ...order, items, salesOwner: safe(salesOwner) };
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Get existing customer repeat orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get timeline for existing customer ──
router.get("/existing-customers/:id/timeline", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { ec } = access;

    const contactId = ec.contactId;
    const events: any[] = [];

    // Lead creation
    const contact = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).then(r => r[0]);
    if (contact) {
      events.push({
        id: `lead-${contact.id}`,
        type: "lead_created",
        description: `Lead created`,
        user: "System",
        createdAt: contact.createdAt,
      });
    }

    // Existing customer promotion
    events.push({
      id: `customer-${ec.id}`,
      type: "customer_promoted",
      description: `Became an existing customer (First order)`,
      user: "System",
      createdAt: ec.createdAt,
    });

    // Orders timeline
    const orders = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.contactId, contactId), eq(ordersTable.isDeleted, false)))
      .orderBy(asc(ordersTable.createdAt));
    for (const order of orders) {
      events.push({
        id: `order-${order.id}`,
        type: "order_created",
        description: `Order ${order.orderNumber} created (${order.status})`,
        user: order.salesOwnerId ? (await db.select().from(usersTable).where(eq(usersTable.id, order.salesOwnerId)).then(r => r[0]?.name || "System")) : "System",
        createdAt: order.createdAt,
      });

      // Order timeline events
      const timelineEntries = await db.select().from(orderTimelineTable)
        .where(eq(orderTimelineTable.orderId, order.id))
        .orderBy(asc(orderTimelineTable.createdAt));
      for (const entry of timelineEntries) {
        events.push({
          id: `timeline-${entry.id}`,
          type: "order_event",
          description: entry.description,
          user: entry.createdBy ? (await db.select().from(usersTable).where(eq(usersTable.id, entry.createdBy)).then(r => r[0]?.name || "System")) : "System",
          createdAt: entry.createdAt,
        });
      }
    }

    // Complaint events
    const complaints = await db.select({
      id: complaintsTable.id,
      complaintNumber: complaintsTable.complaintNumber,
      complaintType: complaintsTable.complaintType,
      status: complaintsTable.status,
      createdAt: complaintsTable.createdAt,
      updatedAt: complaintsTable.updatedAt,
    }).from(complaintsTable)
      .where(and(eq(complaintsTable.contactId, contactId), eq(complaintsTable.isDeleted, false)))
      .orderBy(asc(complaintsTable.createdAt));
    for (const comp of complaints) {
      events.push({
        id: `complaint-${comp.id}`,
        type: "complaint_created",
        description: `Complaint ${comp.complaintNumber} logged - ${comp.complaintType} (${comp.status})`,
        user: "System",
        createdAt: comp.createdAt,
      });
    }

    // Communication events
    const comms = await db.select({
      id: customerCommunicationsTable.id,
      type: customerCommunicationsTable.type,
      notes: customerCommunicationsTable.notes,
      createdBy: usersTable.name,
      createdAt: customerCommunicationsTable.createdAt,
    }).from(customerCommunicationsTable)
      .leftJoin(usersTable, eq(usersTable.id, customerCommunicationsTable.createdBy))
      .where(eq(customerCommunicationsTable.contactId, contactId))
      .orderBy(asc(customerCommunicationsTable.createdAt));
    for (const comm of comms) {
      events.push({
        id: `comm-${comm.id}`,
        type: "communication",
        description: `${comm.type} communication: ${(comm.notes || "").substring(0, 100)}`,
        user: comm.createdBy || "System",
        createdAt: comm.createdAt,
      });
    }

    // Follow-up (activity) events
    const dealIds = orders.filter(o => o.id).map(o => o.id);
    const activities = await db.select({
      id: activitiesTable.id,
      type: activitiesTable.type,
      notes: activitiesTable.notes,
      followUpType: activitiesTable.followUpType,
      createdBy: usersTable.name,
      createdAt: activitiesTable.createdAt,
    }).from(activitiesTable)
      .leftJoin(usersTable, eq(usersTable.id, activitiesTable.createdBy))
      .where(eq(activitiesTable.contactId, contactId))
      .orderBy(asc(activitiesTable.createdAt));
    for (const act of activities) {
      events.push({
        id: `activity-${act.id}`,
        type: "follow_up",
        description: `${act.followUpType || act.type} follow-up: ${(act.notes || "").substring(0, 100)}`,
        user: act.createdBy || "System",
        createdAt: act.createdAt,
      });
    }

    // Sort all events by date DESC
    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(events);
  } catch (err) {
    console.error("Get existing customer timeline error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create follow-up for existing customer ──
router.post("/existing-customers/:id/follow-ups", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { user, ec } = access;

    // Find or create a deal for the contact to link the activity
    let [deal] = await db.select().from(dealsTable).where(eq(dealsTable.contactId, ec.contactId)).limit(1);
    if (!deal) {
      const contact = await db.select().from(contactsTable).where(eq(contactsTable.id, ec.contactId)).then(r => r[0]);
      [deal] = await db.insert(dealsTable).values({
        contactId: ec.contactId,
        title: `${contact?.name || "Customer"} - Existing Customer Follow-up`,
        stage: "CL Sent",
        salesOwnerId: ec.salesOwnerId || user.id,
        probability: 50,
        totalValue: "0",
      }).returning();
    }

    const [activity] = await db.insert(activitiesTable).values({
      dealId: deal.id,
      contactId: ec.contactId,
      type: req.body.type || "FollowUp",
      notes: req.body.notes || "",
      followUpDate: req.body.followUpDate || null,
      followUpTime: req.body.followUpTime || null,
      followUpType: req.body.followUpType || "General Customer Follow-up",
      priority: req.body.priority || "Medium",
      callStatus: "Pending",
      assignedTo: req.body.assignedTo || user.id,
      createdBy: user.id,
    }).returning();

    // Create notification for sales owner if different
    if (ec.salesOwnerId && ec.salesOwnerId !== user.id) {
      const contact = await db.select().from(contactsTable).where(eq(contactsTable.id, ec.contactId)).then(r => r[0]);
      await createNotification({
        userId: ec.salesOwnerId,
        type: "follow_up_created",
        title: "Follow-up Scheduled",
        message: `Follow-up created for ${contact?.name || "customer"} by ${user.name}\nType: ${req.body.followUpType || "General Customer Follow-up"}\nDate: ${req.body.followUpDate || "Not set"}`,
        link: `/follow-ups`,
        relatedId: activity.id,
        relatedType: "activity",
      });
    }

    res.status(201).json(activity);
  } catch (err) {
    console.error("Create follow-up error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create repeat order ──
router.post("/existing-customers/:id/repeat-order", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await enforceExistingCustomerAccess(req, res, id);
    if (!access) return;
    const { user, ec } = access;

    // Get the source order (last order or first order)
    const sourceOrderId = ec.lastOrderId || ec.firstOrderId;
    if (!sourceOrderId) { res.status(400).json({ error: "No source order found" }); return; }

    const [sourceOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, sourceOrderId));
    if (!sourceOrder) { res.status(404).json({ error: "Source order not found" }); return; }

    const sourceItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, sourceOrderId));
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, ec.contactId));

    // Generate new order number
    const orderNumber = await generateId("order");

    // Create new order copying from source
    const overrides = req.body || {};
    const [newOrder] = await db.insert(ordersTable).values({
      orderNumber,
      contactId: ec.contactId,
      customerName: contact?.name || sourceOrder.customerName,
      companyName: contact?.companyName || sourceOrder.companyName,
      mobile: contact?.mobile || sourceOrder.mobile,
      email: contact?.email || sourceOrder.email,
      gstNumber: sourceOrder.gstNumber,
      address: contact?.address || sourceOrder.address,
      city: contact?.city || sourceOrder.city,
      state: contact?.state || sourceOrder.state,
      source: "Repeat Order",
      customerType: "Existing Customer",
      status: "Draft",
      salesOwnerId: sourceOrder.salesOwnerId,
      supportOwnerId: user.role === "production_and_support" ? user.id : sourceOrder.supportOwnerId,
      createdBy: user.id,
      previousOrderId: sourceOrder.id,
      isRepeatOrder: true,
      freight: sourceOrder.freight,
      paymentTerms: sourceOrder.paymentTerms,
      deliveryTerms: sourceOrder.deliveryTerms,
      dispatchAddress: sourceOrder.dispatchAddress,
      transportDetails: sourceOrder.transportDetails,
      remarks: overrides.remarks || `Repeat order for ${contact?.companyName || contact?.name || "customer"}`,
    }).returning();

    // Copy items from source (adjust quantities if provided)
    const overrideItems = overrides.items || [];
    for (const item of sourceItems) {
      const overrideItem = overrideItems.find((oi: any) => oi.productName === item.productName);
      const qty = overrideItem ? overrideItem.quantity : item.quantity;
      const amount = Number(qty) * Number(item.rate);
      await db.insert(orderItemsTable).values({
        orderId: newOrder.id,
        productId: item.productId,
        productName: item.productName,
        productCode: item.productCode,
        bottleType: item.bottleType,
        bottleWeight: item.bottleWeight,
        capColour: item.capColour,
        colour: item.colour,
        hsnCode: item.hsnCode,
        capacity: item.capacity,
        quantity: String(qty),
        unit: item.unit,
        rate: item.rate,
        gstPercent: item.gstPercent,
        amount: String(amount),
      });
    }

    // Calculate totals
    const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, newOrder.id));
    const totalAmount = allItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalGst = allItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstPercent || 0) / 100, 0);
    const grandTotal = totalAmount + totalGst + Number(newOrder.freight || 0);

    await db.update(ordersTable).set({
      totalAmount: String(totalAmount),
      totalGst: String(totalGst),
      grandTotal: String(grandTotal),
    }).where(eq(ordersTable.id, newOrder.id));

    // Timeline
    await db.insert(orderTimelineTable).values({
      orderId: newOrder.id,
      type: "repeat_order_created",
      description: `Repeat order ${orderNumber} created from ${sourceOrder.orderNumber} by ${user.name}`,
      createdBy: user.id,
    });

    // Update existing customer stats
    await refreshExistingCustomerStats(ec.contactId);

    // Notify: original sales owner, production, admin
    const notifyUsers = new Set<number>();
    if (sourceOrder.salesOwnerId && sourceOrder.salesOwnerId !== user.id) notifyUsers.add(sourceOrder.salesOwnerId);

    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) { if (admin.id !== user.id) notifyUsers.add(admin.id); }

    const productionUsers = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "production"));
    for (const pu of productionUsers) { if (pu.id !== user.id) notifyUsers.add(pu.id); }

    for (const uid of notifyUsers) {
      await createNotification({
        userId: uid,
        type: "repeat_order_created",
        title: "Repeat Order Created",
        message: `${user.name} created a Repeat Order for ${contact?.companyName || contact?.name || "customer"}.\nOrder: ${orderNumber}`,
        link: `/orders/${newOrder.id}`,
        relatedId: newOrder.id,
        relatedType: "order",
      });
    }

    // Audit
    try {
      const { logAudit } = require("../middlewares/auth");
      await logAudit("order", newOrder.id, "repeat_order_created", null, newOrder, user.id, undefined, user.role);
    } catch { /* audit optional */ }

    // Return enriched order
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, newOrder.id));
    const salesOwner = newOrder.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, newOrder.salesOwnerId)).then(r => r[0]) : null;
    const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;

    res.status(201).json({ ...newOrder, items, salesOwner: safe(salesOwner) });
  } catch (err) {
    console.error("Create repeat order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Refresh stats for a single customer (internal use) ──
router.post("/existing-customers/refresh/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    await refreshExistingCustomerStats(contactId);
    const [ec] = await db.select().from(existingCustomersTable).where(eq(existingCustomersTable.contactId, contactId));
    res.json(ec || null);
  } catch (err) {
    console.error("Refresh existing customer stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
