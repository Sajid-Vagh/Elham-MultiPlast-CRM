import { Router, type IRouter } from "express";
import { db, quotationsTable, quotationItemsTable, ordersTable, orderItemsTable, orderTimelineTable, usersTable, contactsTable } from "@workspace/db";
import { eq, desc, sql, and, or, ilike } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";
import { promoteToExistingCustomer } from "./existing-customers";

const router: IRouter = Router();

async function enrichQuotation(q: any) {
  const items = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, q.id));
  const owner = q.salesOwnerId ? await db.select().from(usersTable).where(eq(usersTable.id, q.salesOwnerId)).then(r => r[0]) : null;
  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;
  return { ...q, items: items.map(i => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate), amount: Number(i.amount), gstPercent: Number(i.gstPercent || 0) })), salesOwner: safe(owner) };
}

// List quotations
router.get("/quotations", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [eq(quotationsTable.isDeleted, false)];

    if (user.role === "sales") conditions.push(eq(quotationsTable.salesOwnerId, user.id));
    if (status && status !== "All") conditions.push(eq(quotationsTable.status, status));
    if (search) {
      const s = `%${search}%`;
      conditions.push(or(ilike(quotationsTable.quotationNumber, s), ilike(quotationsTable.customerName, s), ilike(quotationsTable.companyName, s))!);
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(quotationsTable).where(and(...conditions));
    const quotes = await db.select().from(quotationsTable).where(and(...conditions)).orderBy(desc(quotationsTable.createdAt)).limit(limitNum).offset((pageNum - 1) * limitNum);
    const enriched = await Promise.all(quotes.map(enrichQuotation));

    res.json({ data: enriched, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
  } catch (err) {
    console.error("List quotations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single quotation
router.get("/quotations/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [q] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, Number(req.params.id)));
    if (!q) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichQuotation(q));
  } catch (err) {
    console.error("Get quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create quotation
router.post("/quotations", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { items, ...quoteData } = req.body;
    const quotationNumber = await generateId("quotation");

    const [quotation] = await db.insert(quotationsTable).values({
      ...quoteData,
      quotationNumber,
      createdBy: user.id,
      salesOwnerId: quoteData.salesOwnerId || (user.role === "sales" ? user.id : null),
    }).returning();

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const amount = Number(item.quantity || 0) * Number(item.rate || 0);
        await db.insert(quotationItemsTable).values({
          quotationId: quotation.id,
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
        });
      }
    }

    const allItems = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, quotation.id));
    const totalAmount = allItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalGst = allItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstPercent || 0) / 100, 0);

    await db.update(quotationsTable).set({
      totalAmount: String(totalAmount),
      totalGst: String(totalGst),
      grandTotal: String(totalAmount + totalGst + Number(quotation.freight || 0)),
    }).where(eq(quotationsTable.id, quotation.id));

    res.status(201).json(await enrichQuotation(quotation));
  } catch (err) {
    console.error("Create quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update quotation
router.patch("/quotations/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const { items, ...updateData } = req.body;

    const [updated] = await db.update(quotationsTable).set({ ...updateData, updatedAt: new Date() }).where(eq(quotationsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (item.id) {
          const amount = Number(item.quantity || 0) * Number(item.rate || 0);
          await db.update(quotationItemsTable).set({ productName: item.productName, quantity: String(item.quantity), rate: String(item.rate || 0), gstPercent: String(item.gstPercent || 0), amount: String(amount) }).where(eq(quotationItemsTable.id, item.id));
        } else {
          const amount = Number(item.quantity || 0) * Number(item.rate || 0);
          await db.insert(quotationItemsTable).values({ quotationId: id, productName: item.productName, quantity: String(item.quantity), rate: String(item.rate || 0), gstPercent: String(item.gstPercent || 0), amount: String(amount) });
        }
      }
    }

    const allItems = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));
    const totalAmount = allItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalGst = allItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstPercent || 0) / 100, 0);
    await db.update(quotationsTable).set({ totalAmount: String(totalAmount), totalGst: String(totalGst), grandTotal: String(totalAmount + totalGst + Number(updated.freight || 0)) }).where(eq(quotationsTable.id, id));

    res.json(await enrichQuotation(updated));
  } catch (err) {
    console.error("Update quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Convert quotation to order
router.post("/quotations/:id/convert", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [quotation] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, id));
    if (!quotation) { res.status(404).json({ error: "Not found" }); return; }
    if (quotation.status === "Converted to Order") { res.status(400).json({ error: "Already converted" }); return; }

    const orderNumber = await generateId("order");

    const [order] = await db.insert(ordersTable).values({
      orderNumber,
      contactId: quotation.contactId,
      customerName: quotation.customerName,
      companyName: quotation.companyName,
      mobile: quotation.mobile,
      email: quotation.email,
      gstNumber: quotation.gstNumber,
      address: quotation.address,
      city: quotation.city,
      state: quotation.state,
      source: "Existing Customer",
      customerType: "Existing Customer",
      status: "Pending Verification",
      salesOwnerId: quotation.salesOwnerId,
      createdBy: user.id,
      totalAmount: quotation.totalAmount,
      totalGst: quotation.totalGst,
      grandTotal: quotation.grandTotal,
      freight: quotation.freight,
      paymentTerms: quotation.paymentTerms,
      deliveryTerms: quotation.deliveryTerms,
      quotationId: quotation.id,
    }).returning();

    // Copy items
    const quoteItems = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));
    for (const qi of quoteItems) {
      await db.insert(orderItemsTable).values({
        orderId: order.id,
        productId: qi.productId,
        productName: qi.productName,
        productCode: qi.productCode,
        bottleType: qi.bottleType,
        bottleWeight: qi.bottleWeight,
        capColour: qi.capColour,
        colour: qi.colour,
        hsnCode: qi.hsnCode,
        capacity: qi.capacity,
        quantity: qi.quantity,
        unit: qi.unit,
        rate: qi.rate,
        gstPercent: qi.gstPercent,
        amount: qi.amount,
      });
    }

    await db.update(quotationsTable).set({ status: "Converted to Order", convertedOrderId: order.id, convertedAt: new Date(), updatedAt: new Date() }).where(eq(quotationsTable.id, id));

    await db.insert(orderTimelineTable).values({
      orderId: order.id,
      type: "order_created",
      description: `Order created from Quotation ${quotation.quotationNumber}`,
      createdBy: user.id,
    });

    // Promote contact to existing customer
    try {
      const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
      if (updatedOrder) await promoteToExistingCustomer(updatedOrder);
    } catch (promoErr) {
      console.error("Failed to promote to existing customer:", promoErr);
    }

    res.json({ order, quotation });
  } catch (err) {
    console.error("Convert quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete quotation (soft)
router.delete("/quotations/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    await db.update(quotationsTable).set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id }).where(eq(quotationsTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("Delete quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
