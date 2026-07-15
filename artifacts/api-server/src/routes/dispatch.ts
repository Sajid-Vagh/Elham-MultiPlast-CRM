import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import { db, dispatchTable, dispatchItemsTable, ordersTable, orderItemsTable, usersTable, orderTimelineTable, productionOrdersTable, proformaInvoicesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";
import { storage } from "../lib/storage";

const router: IRouter = Router();
const builtyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only PDF, JPG, PNG, WEBP files allowed"));
  },
});

async function enrichDispatch(d: any) {
  const items = await db.select().from(dispatchItemsTable).where(eq(dispatchItemsTable.dispatchId, d.id));
  const handler = d.dispatchHandledBy ? await db.select().from(usersTable).where(eq(usersTable.id, d.dispatchHandledBy)).then(r => r[0]) : null;
  const order = d.orderId ? await db.select().from(ordersTable).where(eq(ordersTable.id, d.orderId)).then(r => r[0]) : null;
  let productionOrder = null;
  let invoice = null;
  if (d.productionOrderId) {
    productionOrder = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, d.productionOrderId)).then(r => r[0]) || null;
    if (productionOrder?.proformaInvoiceId) {
      invoice = await db.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, productionOrder.proformaInvoiceId)).then(r => r[0]) || null;
    }
  }
  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;
  return {
    ...d,
    items,
    handler: safe(handler),
    order: order ? { id: order.id, orderNumber: order.orderNumber, customerName: order.customerName } : null,
    productionOrder: productionOrder ? { id: productionOrder.id, status: productionOrder.status, productionUnit: productionOrder.productionUnit } : null,
    invoice: invoice ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerName: invoice.customerName, companyName: invoice.companyName } : null,
  };
}

// List dispatch
router.get("/dispatch", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [eq(dispatchTable.isDeleted, false)];

    if (status && status !== "All") conditions.push(eq(dispatchTable.status, status));
    if (search) {
      conditions.push(sql`(${dispatchTable.dispatchNumber} ILIKE ${`%${search}%`} OR ${dispatchTable.remarks} ILIKE ${`%${search}%`})`);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(dispatchTable).where(where);
    const dispatches = await db.select().from(dispatchTable).where(where).orderBy(desc(dispatchTable.createdAt)).limit(limitNum).offset((pageNum - 1) * limitNum);
    const enriched = await Promise.all(dispatches.map(enrichDispatch));

    res.json({ data: enriched, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
  } catch (err) {
    console.error("List dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single dispatch
router.get("/dispatch/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [d] = await db.select().from(dispatchTable).where(eq(dispatchTable.id, Number(req.params.id)));
    if (!d) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichDispatch(d));
  } catch (err) {
    console.error("Get dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create dispatch
router.post("/dispatch", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { items, ...dispatchData } = req.body;
    const dispatchNumber = await generateId("dispatch");

    const [dispatch] = await db.insert(dispatchTable).values({
      ...dispatchData,
      dispatchNumber,
      createdBy: user.id,
    }).returning();

    if (items && Array.isArray(items)) {
      for (const item of items) {
        await db.insert(dispatchItemsTable).values({
          dispatchId: dispatch.id,
          orderItemId: item.orderItemId,
          productName: item.productName,
          quantity: String(item.quantity),
          batchNumber: item.batchNumber,
        });
      }
    }

    // Update order status if linked to an order
    if (dispatch.orderId) {
      await db.update(ordersTable).set({ status: "Dispatched", dispatchHandledBy: user.id, updatedAt: new Date() }).where(eq(ordersTable.id, dispatch.orderId));
      await db.insert(orderTimelineTable).values({ orderId: dispatch.orderId, type: "dispatch_created", description: `Dispatch ${dispatchNumber} created`, createdBy: user.id });

      const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, dispatch.orderId));
      if (order?.salesOwnerId) {
        await createNotification({ userId: order.salesOwnerId, type: "dispatch_created", title: "Dispatch Created", message: `Dispatch ${dispatchNumber} created for Order ${order.orderNumber}`, link: `/orders/${order.id}`, relatedId: order.id, relatedType: "order" });
      }
    }

    // Update production order status if linked to a production order
    if (dispatch.productionOrderId) {
      await db.update(productionOrdersTable).set({ status: "Dispatched", updatedBy: user.id, updatedAt: new Date() }).where(eq(productionOrdersTable.id, dispatch.productionOrderId));
    }

    res.status(201).json(await enrichDispatch(dispatch));
  } catch (err) {
    console.error("Create dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update dispatch
router.patch("/dispatch/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const { status, ...updateData } = req.body;

    const [existing] = await db.select().from(dispatchTable).where(eq(dispatchTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updatePayload: any = { ...updateData, updatedAt: new Date() };
    if (status) {
      updatePayload.status = status;
      if (status === "Delivered") updatePayload.deliveredDate = new Date().toISOString().slice(0, 10);
    }

    const [updated] = await db.update(dispatchTable).set(updatePayload).where(eq(dispatchTable.id, id)).returning();

    if (status && status !== existing.status) {
      // Update linked order status
      if (existing.orderId) {
        const orderStatus = status === "Delivered" ? "Delivered" : status === "Dispatched" ? "Dispatched" : undefined;
        if (orderStatus) {
          await db.update(ordersTable).set({ status: orderStatus, updatedAt: new Date() }).where(eq(ordersTable.id, existing.orderId));
        }
        await db.insert(orderTimelineTable).values({ orderId: existing.orderId, type: "dispatch_status_change", description: `Dispatch ${existing.dispatchNumber}: ${existing.status} → ${status}`, createdBy: user.id });

        const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, existing.orderId));
        if (order?.salesOwnerId) {
          await createNotification({ userId: order.salesOwnerId, type: "dispatch_status_changed", title: "Dispatch Status Updated", message: `Dispatch ${existing.dispatchNumber}: ${existing.status} → ${status}`, link: `/orders/${order.id}`, relatedId: order.id, relatedType: "order" });
        }
      }

      // Update linked production order status
      if (existing.productionOrderId) {
        const poStatus = status === "Delivered" ? "Completed" : status === "Dispatched" ? "Ready For Dispatch" : undefined;
        if (poStatus) {
          await db.update(productionOrdersTable).set({ status: poStatus, updatedBy: user.id, updatedAt: new Date() }).where(eq(productionOrdersTable.id, existing.productionOrderId));
        }
      }
    }

    res.json(await enrichDispatch(updated));
  } catch (err) {
    console.error("Update dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete dispatch (soft)
router.delete("/dispatch/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    await db.update(dispatchTable).set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id }).where(eq(dispatchTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("Delete dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload builty (transport receipt) for a dispatch
router.post("/dispatch/:id/builty", builtyUpload.single("file"), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }

    const [dispatch] = await db.select().from(dispatchTable).where(eq(dispatchTable.id, id));
    if (!dispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }

    const storagePath = await storage.save(file.originalname, file.buffer, "builty");
    const fileUrl = `/uploads/builty/${path.basename(storagePath)}`;

    await db.update(dispatchTable).set({ proofOfDelivery: fileUrl, updatedAt: new Date() }).where(eq(dispatchTable.id, id));

    // Also update the linked production order's builtyUrl
    if (dispatch.productionOrderId) {
      await db.update(productionOrdersTable).set({ builtyUrl: fileUrl, updatedAt: new Date() }).where(eq(productionOrdersTable.id, dispatch.productionOrderId));
    }

    res.json({ url: fileUrl });
  } catch (err) {
    console.error("Upload builty error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
