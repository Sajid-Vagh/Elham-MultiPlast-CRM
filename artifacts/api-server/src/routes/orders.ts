import { Router, type IRouter } from "express";
import { db, ordersTable, orderItemsTable, usersTable, contactsTable, orderTimelineTable, orderRevisionsTable } from "@workspace/db";
import { eq, and, or, ilike, desc, sql, inArray } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";
import { logAudit } from "../middlewares/auth";
import { promoteToExistingCustomer } from "./existing-customers";
import { getAccessibleUnits } from "../lib/unit-filter";
import { cancelOrder } from "../lib/order-cancellation-service";

const PRODUCTION_UNITS = ["Himatnagar", "Surat", "Rajkot"] as const;

const router: IRouter = Router();

async function enrichOrder(order: any) {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const salesOwner = order.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, order.salesOwnerId)).then(r => r[0]) : null;
  const supportOwner = order.supportOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, order.supportOwnerId)).then(r => r[0]) : null;
  const productionOwner = order.productionOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, order.productionOwnerId)).then(r => r[0]) : null;
  const creator = order.createdBy ? await db.select().from(usersTable).where(eq(usersTable.id, order.createdBy)).then(r => r[0]) : null;

  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;

  return {
    ...order,
    items: items.map(i => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate), amount: Number(i.amount), gstPercent: Number(i.gstPercent || 0), readyQuantity: Number(i.readyQuantity), dispatchedQuantity: Number(i.dispatchedQuantity) })),
    salesOwner: safe(salesOwner),
    supportOwner: safe(supportOwner),
    productionOwner: safe(productionOwner),
    createdByUser: safe(creator),
  };
}

// List orders
router.get("/orders", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, source, salesOwnerId, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [eq(ordersTable.isDeleted, false)];

    if (user.role === "sales") conditions.push(eq(ordersTable.salesOwnerId, user.id));
    if (user.role === "production_and_support") conditions.push(eq(ordersTable.supportOwnerId, user.id));
    if (user.role === "production") conditions.push(eq(ordersTable.productionOwnerId, user.id));

    if (status && status !== "All") conditions.push(eq(ordersTable.status, status));
    if (source) conditions.push(eq(ordersTable.source, source));
    if (salesOwnerId && user.role === "admin") conditions.push(eq(ordersTable.salesOwnerId, Number(salesOwnerId)));
    if (search) {
      const s = `%${search}%`;
      conditions.push(or(
        ilike(ordersTable.orderNumber, s),
        ilike(ordersTable.customerName, s),
        ilike(ordersTable.companyName, s),
        ilike(ordersTable.mobile, s),
      )!);
    }

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(inArray(ordersTable.productionUnit, accessibleUnits));
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(and(...conditions));
    const orders = await db.select().from(ordersTable).where(and(...conditions)).orderBy(desc(ordersTable.createdAt)).limit(limitNum).offset(offset);

    const enriched = await Promise.all(orders.map(enrichOrder));

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
    console.error("List orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single order
router.get("/orders/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!order) { res.status(404).json({ error: "Not found" }); return; }

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits && !accessibleUnits.includes(order.productionUnit)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    res.json(await enrichOrder(order));
  } catch (err) {
    console.error("Get order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create order
router.post("/orders", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { items, transportSnapshot, ...orderData } = req.body;

    const orderNumber = await generateId("order");

    // Determine order type and revenue ownership
    const orderType = orderData.orderType || (orderData.source === "Repeat Order" ? "REPEAT" : "NEW");
    const createdByRole = user.role === "admin" || user.role === "sales" ? "SALES" : "SUPPORT";
    // Revenue owner: NEW → sales owner, REPEAT → support user who created it
    let revenueOwnerId = orderData.revenueOwnerId || null;
    if (!revenueOwnerId) {
      if (orderType === "NEW") {
        revenueOwnerId = orderData.salesOwnerId || (user.role === "sales" ? user.id : null);
      } else {
        // REPEAT order revenue belongs to the support user who created it
        revenueOwnerId = user.id;
      }
    }

    // Transport snapshot: preserve master data at time of order
    const transportSnapshotData: any = {};
    if (transportSnapshot) {
      transportSnapshotData.transportMasterId = transportSnapshot.transportMasterId || null;
      transportSnapshotData.transportCompany = transportSnapshot.transportCompany || null;
      transportSnapshotData.freightChargeSnapshot = transportSnapshot.freightCharge ? String(transportSnapshot.freightCharge) : null;
      transportSnapshotData.transitDaysSnapshot = transportSnapshot.transitDays || null;
    }

    const [order] = await db.insert(ordersTable).values({
      ...orderData,
      ...transportSnapshotData,
      orderNumber,
      orderType,
      createdByRole,
      revenueOwnerId: revenueOwnerId || null,
      createdBy: user.id,
      salesOwnerId: orderData.salesOwnerId || (user.role === "sales" ? user.id : null),
      status: orderData.status || "Draft",
    }).returning();

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const amount = Number(item.quantity || 0) * Number(item.rate || 0);
        const gstAmount = amount * Number(item.gstPercent || 0) / 100;
        await db.insert(orderItemsTable).values({
          orderId: order.id,
          productId: item.productId,
          productName: item.productName,
          productCode: item.productCode,
          bottleType: item.bottleType,
          bottleWeight: item.bottleWeight,
          capColour: item.capColour,
          colour: item.colour,
          hsnCode: item.hsnCode,
          capacity: item.capacity,
          quantity: String(item.quantity),
          unit: item.unit || "Pcs",
          rate: String(item.rate || 0),
          gstPercent: String(item.gstPercent || 0),
          amount: String(amount),
          // Packing snapshot per item
          packingMasterId: item.packingMasterId || null,
          linerPackingQty: Number(item.linerPackingQty || 0),
          tciBoraQty: Number(item.tciBoraQty || 0),
          normalBoraQty: Number(item.normalBoraQty || 0),
        });
      }
    }

    // Calculate totals
    const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    const totalAmount = allItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalGst = allItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstPercent || 0) / 100, 0);
    const grandTotal = totalAmount + totalGst + Number(order.freight || 0);

    await db.update(ordersTable).set({
      totalAmount: String(totalAmount),
      totalGst: String(totalGst),
      grandTotal: String(grandTotal),
    }).where(eq(ordersTable.id, order.id));

    // Timeline
    await db.insert(orderTimelineTable).values({
      orderId: order.id,
      type: "order_created",
      description: `Order ${orderNumber} created`,
      createdBy: user.id,
    });

    // Notify relevant users
    const notifyUsers = new Set<number>();
    if (order.salesOwnerId && order.salesOwnerId !== user.id) notifyUsers.add(order.salesOwnerId);
    if (order.supportOwnerId && order.supportOwnerId !== user.id) notifyUsers.add(order.supportOwnerId);
    if (order.productionOwnerId && order.productionOwnerId !== user.id) notifyUsers.add(order.productionOwnerId);

    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) { if (admin.id !== user.id) notifyUsers.add(admin.id); }

    for (const uid of notifyUsers) {
      await createNotification({
        userId: uid,
        type: "order_created",
        title: "New Order Created",
        message: `Order ${orderNumber} created by ${user.name}\nCustomer: ${order.customerName}`,
        link: `/orders/${order.id}`,
        relatedId: order.id,
        relatedType: "order",
      });
    }

    // Audit log
    await logAudit("order", order.id, "created", null, order, user.id, undefined, user.role);

    res.status(201).json(await enrichOrder(order));
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update order
router.patch("/orders/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { items, transportSnapshot, ...updateData } = req.body;

    // Track status changes for timeline
    if (updateData.status && updateData.status !== existing.status) {
      await db.insert(orderTimelineTable).values({
        orderId: id,
        type: "status_change",
        description: `Status changed from "${existing.status}" to "${updateData.status}"`,
        createdBy: user.id,
      });

      // Notify relevant users about status change
      const notifyUsers = new Set<number>();
      if (existing.salesOwnerId && existing.salesOwnerId !== user.id) notifyUsers.add(existing.salesOwnerId);
      if (existing.supportOwnerId && existing.supportOwnerId !== user.id) notifyUsers.add(existing.supportOwnerId);
      if (existing.productionOwnerId && existing.productionOwnerId !== user.id) notifyUsers.add(existing.productionOwnerId);
      const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
      for (const admin of admins) { if (admin.id !== user.id) notifyUsers.add(admin.id); }

      for (const uid of notifyUsers) {
        await createNotification({
          userId: uid,
          type: "order_status_changed",
          title: "Order Status Updated",
          message: `Order ${existing.orderNumber} status: ${existing.status} → ${updateData.status}\nUpdated by: ${user.name}`,
          link: `/orders/${id}`,
          relatedId: id,
          relatedType: "order",
        });
      }
    }

    // Transport snapshot on update
    if (transportSnapshot) {
      updateData.transportMasterId = transportSnapshot.transportMasterId || existing.transportMasterId;
      updateData.transportCompany = transportSnapshot.transportCompany || existing.transportCompany;
      updateData.freightChargeSnapshot = transportSnapshot.freightCharge ? String(transportSnapshot.freightCharge) : existing.freightChargeSnapshot;
      updateData.transitDaysSnapshot = transportSnapshot.transitDays || existing.transitDaysSnapshot;
    }

    // Update order
    const [updated] = await db.update(ordersTable).set({ ...updateData, updatedAt: new Date() }).where(eq(ordersTable.id, id)).returning();

    // Promote to existing customer when first order is Delivered or Completed
    if (updateData.status && ["Delivered", "Completed"].includes(updateData.status) && existing.contactId) {
      try {
        const [promoOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
        if (promoOrder) await promoteToExistingCustomer(promoOrder);
      } catch (promoErr) {
        console.error("Failed to promote to existing customer:", promoErr);
      }
    }

    // Update items if provided
    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (item.id) {
          const amount = Number(item.quantity || 0) * Number(item.rate || 0);
          await db.update(orderItemsTable).set({
            productName: item.productName,
            quantity: String(item.quantity),
            rate: String(item.rate || 0),
            gstPercent: String(item.gstPercent || 0),
            amount: String(amount),
            status: item.status,
            readyQuantity: String(item.readyQuantity || 0),
            dispatchedQuantity: String(item.dispatchedQuantity || 0),
            packingMasterId: item.packingMasterId || null,
            linerPackingQty: Number(item.linerPackingQty || 0),
            tciBoraQty: Number(item.tciBoraQty || 0),
            normalBoraQty: Number(item.normalBoraQty || 0),
            updatedAt: new Date(),
          }).where(eq(orderItemsTable.id, item.id));
        } else {
          const amount = Number(item.quantity || 0) * Number(item.rate || 0);
          await db.insert(orderItemsTable).values({
            orderId: id,
            productId: item.productId,
            productName: item.productName,
            productCode: item.productCode,
            quantity: String(item.quantity),
            unit: item.unit || "Pcs",
            rate: String(item.rate || 0),
            gstPercent: String(item.gstPercent || 0),
            amount: String(amount),
            packingMasterId: item.packingMasterId || null,
            linerPackingQty: Number(item.linerPackingQty || 0),
            tciBoraQty: Number(item.tciBoraQty || 0),
            normalBoraQty: Number(item.normalBoraQty || 0),
          });
        }
      }
    }

    // Recalculate totals
    const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
    const totalAmount = allItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalGst = allItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstPercent || 0) / 100, 0);
    const grandTotal = totalAmount + totalGst + Number(updated.freight || 0);

    await db.update(ordersTable).set({ totalAmount: String(totalAmount), totalGst: String(totalGst), grandTotal: String(grandTotal) }).where(eq(ordersTable.id, id));

    // Audit
    await logAudit("order", id, "updated", existing, updated, user.id, undefined, user.role);

    res.json(await enrichOrder(updated));
  } catch (err) {
    console.error("Update order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete order (soft)
router.delete("/orders/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!order) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(ordersTable).set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id }).where(eq(ordersTable.id, id));

    await logAudit("order", id, "deleted", order, null, user.id, undefined, user.role);

    res.status(204).send();
  } catch (err) {
    console.error("Delete order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cancel order with reason + cascading updates ──
router.post("/orders/:id/cancel", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid order id" }); return; }

    const { reason, otherReason, note } = req.body;
    const result = await cancelOrder(user, id, { reason, otherReason, note });

    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }

    res.json({ success: true, order: result.order });
  } catch (err) {
    console.error("Cancel order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get order timeline
router.get("/orders/:id/timeline", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const events = await db.select({
      id: orderTimelineTable.id,
      type: orderTimelineTable.type,
      description: orderTimelineTable.description,
      metadata: orderTimelineTable.metadata,
      createdBy: usersTable.name,
      createdAt: orderTimelineTable.createdAt,
    }).from(orderTimelineTable)
      .leftJoin(usersTable, eq(usersTable.id, orderTimelineTable.createdBy))
      .where(eq(orderTimelineTable.orderId, id))
      .orderBy(desc(orderTimelineTable.createdAt));

    res.json(events);
  } catch (err) {
    console.error("Get order timeline error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get order revisions
router.get("/orders/:id/revisions", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const revisions = await db.select({
      id: orderRevisionsTable.id,
      version: orderRevisionsTable.version,
      reason: orderRevisionsTable.reason,
      changes: orderRevisionsTable.changes,
      status: orderRevisionsTable.status,
      department: orderRevisionsTable.department,
      changedBy: usersTable.name,
      approvedBy: orderRevisionsTable.approvedBy,
      approvedAt: orderRevisionsTable.approvedAt,
      createdAt: orderRevisionsTable.createdAt,
    }).from(orderRevisionsTable)
      .leftJoin(usersTable, eq(usersTable.id, orderRevisionsTable.changedBy))
      .where(eq(orderRevisionsTable.orderId, id))
      .orderBy(desc(orderRevisionsTable.createdAt));

    res.json(revisions);
  } catch (err) {
    console.error("Get order revisions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create order revision
router.post("/orders/:id/revisions", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const orderId = Number(req.params.id);
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!existing) { res.status(404).json({ error: "Order not found" }); return; }

    const { reason, changes, department, approvalRequired } = req.body;
    if (!reason) { res.status(400).json({ error: "Reason is required" }); return; }

    // Get current version
    const [lastRevision] = await db.select({ version: orderRevisionsTable.version })
      .from(orderRevisionsTable)
      .where(eq(orderRevisionsTable.orderId, orderId))
      .orderBy(desc(orderRevisionsTable.version))
      .limit(1);

    const nextVersion = (lastRevision?.version || 0) + 1;

    const [revision] = await db.insert(orderRevisionsTable).values({
      orderId,
      version: nextVersion,
      changedBy: user.id,
      department,
      reason,
      changes: JSON.stringify(changes),
      previousData: JSON.stringify(existing),
      approvalRequired: approvalRequired || false,
      status: approvalRequired ? "Pending" : "Approved",
    }).returning();

    // Timeline
    await db.insert(orderTimelineTable).values({
      orderId,
      type: "revision_created",
      description: `Revision ${nextVersion} created: ${reason}`,
      createdBy: user.id,
    });

    // Notify production if approval required
    if (approvalRequired) {
      const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          type: "revision_approval_required",
          title: "Order Revision Needs Approval",
          message: `Order ${existing.orderNumber} revision ${nextVersion} requires approval.\nReason: ${reason}\nRequested by: ${user.name}`,
          link: `/orders/${orderId}`,
          relatedId: orderId,
          relatedType: "order",
        });
      }
    }

    res.status(201).json(revision);
  } catch (err) {
    console.error("Create revision error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Approve revision
router.patch("/orders/:id/revisions/:revisionId/approve", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "production") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const revisionId = Number(req.params.revisionId);
    const [revision] = await db.select().from(orderRevisionsTable).where(eq(orderRevisionsTable.id, revisionId));
    if (!revision) { res.status(404).json({ error: "Revision not found" }); return; }

    await db.update(orderRevisionsTable).set({
      status: "Approved",
      approvedBy: user.id,
      approvedAt: new Date(),
    }).where(eq(orderRevisionsTable.id, revisionId));

    await db.insert(orderTimelineTable).values({
      orderId: revision.orderId,
      type: "revision_approved",
      description: `Revision ${revision.version} approved by ${user.name}`,
      createdBy: user.id,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Approve revision error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Product-wise demand aggregation for production planning
router.get("/orders/product-demand", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const demand = await db.execute(sql`
      SELECT
        oi.product_name,
        oi.product_code,
        oi.bottle_type,
        oi.bottle_weight,
        oi.cap_colour,
        oi.colour,
        oi.capacity,
        SUM(oi.quantity::numeric) as total_demand,
        SUM(oi.ready_quantity::numeric) as total_ready,
        SUM(oi.dispatched_quantity::numeric) as total_dispatched,
        SUM(oi.quantity::numeric) - SUM(oi.ready_quantity::numeric) as remaining,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.is_deleted = false
        AND oi.status NOT IN ('Completed', 'Cancelled', 'Dispatched')
        AND o.status NOT IN ('Cancelled', 'Completed')
      GROUP BY oi.product_name, oi.product_code, oi.bottle_type, oi.bottle_weight, oi.cap_colour, oi.colour, oi.capacity
      ORDER BY remaining DESC
    `);

    res.json(demand.rows || []);
  } catch (err) {
    console.error("Get product demand error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get orders for a specific product (demand drill-down)
router.get("/orders/by-product/:productName", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const productName = decodeURIComponent(req.params.productName);
    const items = await db.select({
      orderId: orderItemsTable.orderId,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      companyName: ordersTable.companyName,
      salesOwnerId: ordersTable.salesOwnerId,
      quantity: orderItemsTable.quantity,
      readyQuantity: orderItemsTable.readyQuantity,
      dispatchedQuantity: orderItemsTable.dispatchedQuantity,
      status: orderItemsTable.status,
      batchNumber: orderItemsTable.batchNumber,
    }).from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(orderItemsTable.productName, productName),
        eq(ordersTable.isDeleted, false),
      ));

    const enriched = await Promise.all(items.map(async (item) => {
      const owner = item.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, item.salesOwnerId)).then(r => r[0]) : null;
      return { ...item, salesOwner: owner ? (({ passwordHash: _, ...rest }) => rest)(owner) : null };
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Get orders by product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
