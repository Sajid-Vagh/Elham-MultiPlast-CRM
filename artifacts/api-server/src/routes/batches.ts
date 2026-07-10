import { Router, type IRouter } from "express";
import { db, productionBatchesTable, productionBatchItemsTable, qcReportsTable, orderItemsTable, ordersTable, usersTable, orderTimelineTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";

const router: IRouter = Router();

async function enrichBatch(batch: any) {
  const items = await db.select().from(productionBatchItemsTable).where(eq(productionBatchItemsTable.batchId, batch.id));
  const manager = batch.assignedProductionManagerId ? await db.select().from(usersTable).where(eq(usersTable.id, batch.assignedProductionManagerId)).then(r => r[0]) : null;
  const creator = batch.createdBy ? await db.select().from(usersTable).where(eq(usersTable.id, batch.createdBy)).then(r => r[0]) : null;
  const qc = await db.select().from(qcReportsTable).where(eq(qcReportsTable.batchId, batch.id)).orderBy(desc(qcReportsTable.createdAt)).limit(1);
  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;
  return { ...batch, items, manager: safe(manager), creator: safe(creator), latestQc: qc[0] || null };
}

// List batches
router.get("/batches", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (status && status !== "All") conditions.push(eq(productionBatchesTable.status, status));
    if (search) conditions.push(sql`${productionBatchesTable.batchNumber} ILIKE ${`%${search}%`} OR ${productionBatchesTable.productName} ILIKE ${`%${search}%`}`);

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(where);
    const batches = await db.select().from(productionBatchesTable).where(where).orderBy(desc(productionBatchesTable.createdAt)).limit(limitNum).offset((pageNum - 1) * limitNum);
    const enriched = await Promise.all(batches.map(enrichBatch));

    res.json({ data: enriched, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
  } catch (err) {
    console.error("List batches error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single batch
router.get("/batches/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [batch] = await db.select().from(productionBatchesTable).where(eq(productionBatchesTable.id, Number(req.params.id)));
    if (!batch) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichBatch(batch));
  } catch (err) {
    console.error("Get batch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create batch (from product demand aggregation)
router.post("/batches", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { productName, productCode, totalQuantity, items, ordersIncluded, machine, operator, shift, expectedCompletionDate, priority, notes } = req.body;
    const batchNumber = await generateId("batch");

    const [batch] = await db.insert(productionBatchesTable).values({
      batchNumber,
      productName,
      productCode,
      totalQuantity: String(totalQuantity),
      priority: priority || "Normal",
      machine,
      operator,
      shift,
      expectedCompletionDate,
      ordersIncluded: JSON.stringify(ordersIncluded || []),
      assignedProductionManagerId: user.id,
      createdBy: user.id,
      notes,
    }).returning();

    if (items && Array.isArray(items)) {
      for (const item of items) {
        await db.insert(productionBatchItemsTable).values({
          batchId: batch.id,
          orderItemId: item.orderItemId,
          orderId: item.orderId,
          productName: item.productName || productName,
          quantity: String(item.quantity),
        });
      }
    }

    res.status(201).json(await enrichBatch(batch));
  } catch (err) {
    console.error("Create batch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update batch status
router.patch("/batches/:id/status", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const { status, completedQuantity, rejectedQuantity, progress, notes } = req.body;

    const [existing] = await db.select().from(productionBatchesTable).where(eq(productionBatchesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updatePayload: any = { status, updatedAt: new Date(), updatedBy: user.id };
    if (completedQuantity !== undefined) updatePayload.completedQuantity = String(completedQuantity);
    if (rejectedQuantity !== undefined) updatePayload.rejectedQuantity = String(rejectedQuantity);
    if (progress !== undefined) updatePayload.progress = progress;
    if (notes) updatePayload.notes = notes;
    if (status === "Completed") updatePayload.actualCompletionDate = new Date().toISOString().slice(0, 10);

    const [updated] = await db.update(productionBatchesTable).set(updatePayload).where(eq(productionBatchesTable.id, id)).returning();

    // Update linked order items
    if (status === "Completed" || status === "QC Passed" || status === "Ready For Dispatch") {
      const linkedItems = await db.select().from(productionBatchItemsTable).where(eq(productionBatchItemsTable.batchId, id));
      for (const bi of linkedItems) {
        if (bi.orderItemId) {
          await db.update(orderItemsTable).set({
            readyQuantity: String(Number(existing.completedQuantity) + Number(completedQuantity || 0)),
            batchNumber: existing.batchNumber,
            status: status === "Ready For Dispatch" ? "Ready for Dispatch" : "Production Running",
            updatedAt: new Date(),
          }).where(eq(orderItemsTable.id, bi.orderItemId));
        }
      }
    }

    // Notify sales/support of production status change
    const linkedBatchItems = await db.select().from(productionBatchItemsTable).where(eq(productionBatchItemsTable.batchId, id));
    for (const bi of linkedBatchItems) {
        if (bi.orderId) {
          const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, bi.orderId));
          if (order?.salesOwnerId) {
            await createNotification({
              userId: order.salesOwnerId,
              type: "production_status",
              title: "Production Status Updated",
              message: `Batch ${existing.batchNumber} (${existing.productName}): ${existing.status} → ${status}`,
              link: `/orders/${order.id}`,
              relatedId: order.id,
              relatedType: "order",
            });
          }
        }
      }

    res.json(await enrichBatch(updated));
  } catch (err) {
    console.error("Update batch status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit QC report
router.post("/batches/:id/qc", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const batchId = Number(req.params.id);
    const { status, bottleWeight, colorCheck, leakTest, capFitting, visualInspection, overallResult, remarks, qcPerson } = req.body;

    const [qc] = await db.insert(qcReportsTable).values({
      batchId,
      status,
      qcPerson: qcPerson || user.name,
      qcDate: new Date().toISOString().slice(0, 10),
      bottleWeight,
      colorCheck,
      leakTest,
      capFitting,
      visualInspection,
      overallResult,
      remarks,
      approvedBy: user.id,
    }).returning();

    // Update batch status based on QC result
    const batchStatus = overallResult === "Pass" ? "QC Passed" : "QC Failed";
    await db.update(productionBatchesTable).set({ status: batchStatus, updatedAt: new Date(), updatedBy: user.id }).where(eq(productionBatchesTable.id, batchId));

    res.status(201).json(qc);
  } catch (err) {
    console.error("Submit QC error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Product-wise demand
router.get("/product-demand", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const demand = await db.execute(sql`
      SELECT
        oi.product_name as "productName",
        oi.product_code as "productCode",
        oi.bottle_type as "bottleType",
        oi.bottle_weight as "bottleWeight",
        oi.cap_colour as "capColour",
        oi.colour as "colour",
        oi.capacity as "capacity",
        SUM(oi.quantity::numeric) as "totalDemand",
        SUM(oi.ready_quantity::numeric) as "totalReady",
        SUM(oi.dispatched_quantity::numeric) as "totalDispatched",
        SUM(oi.quantity::numeric) - SUM(oi.ready_quantity::numeric) as "remaining",
        COUNT(DISTINCT oi.order_id) as "orderCount"
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

// Production dashboard KPIs
router.get("/production-dashboard", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [pendingBatches] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(eq(productionBatchesTable.status, "Planned"));
    const [runningBatches] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(eq(productionBatchesTable.status, "Running"));
    const [completedToday] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(and(eq(productionBatchesTable.status, "Completed"), sql`${productionBatchesTable.actualCompletionDate} = current_date::text`));
    const [qcPending] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(eq(productionBatchesTable.status, "QC Pending"));
    const [readyForDispatch] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(eq(productionBatchesTable.status, "Ready For Dispatch"));
    const [delayed] = await db.select({ count: sql<number>`count(*)::int` }).from(productionBatchesTable).where(sql`${productionBatchesTable.expectedCompletionDate} < current_date::text AND ${productionBatchesTable.status} NOT IN ('Completed', 'Closed')`);

    res.json({
      pendingBatches: pendingBatches?.count || 0,
      runningBatches: runningBatches?.count || 0,
      completedToday: completedToday?.count || 0,
      qcPending: qcPending?.count || 0,
      readyForDispatch: readyForDispatch?.count || 0,
      delayedBatches: delayed?.count || 0,
    });
  } catch (err) {
    console.error("Production dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
