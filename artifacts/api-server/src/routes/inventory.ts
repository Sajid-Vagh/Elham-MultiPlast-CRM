import { Router, type IRouter } from "express";
import { db, inventoryTable, inventoryLogsTable, productsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function canManageInventory(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "inventory";
}

// ── GET /inventory — Fetch inventory with product details, filtered by unit ──
router.get("/inventory", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { unit, search } = req.query as Record<string, string | undefined>;

    const conditions: any[] = [];

    // Unit filter: inventory role with "All" sees everything; others see their unit
    if (user.role === "inventory") {
      const userUnit = user.unit || "All";
      if (userUnit !== "All" && unit) {
        conditions.push(eq(inventoryTable.unitName, unit));
      } else if (userUnit !== "All" && !unit) {
        conditions.push(eq(inventoryTable.unitName, userUnit));
      } else if (unit) {
        conditions.push(eq(inventoryTable.unitName, unit));
      }
    } else if (user.role === "admin") {
      if (unit) {
        conditions.push(eq(inventoryTable.unitName, unit));
      }
    } else {
      // sales and other roles: read-only, filter by their unit
      const userUnit = user.unit || "All";
      if (userUnit !== "All") {
        conditions.push(eq(inventoryTable.unitName, userUnit));
      } else if (unit) {
        conditions.push(eq(inventoryTable.unitName, unit));
      }
    }

    // Join with products to get product details and support search
    let rows = await db
      .select({
        id: inventoryTable.id,
        productId: inventoryTable.productId,
        unitName: inventoryTable.unitName,
        currentStock: inventoryTable.currentStock,
        updatedAt: inventoryTable.updatedAt,
        productName: productsTable.name,
        category: productsTable.category,
        productCode: productsTable.productCode,
        bottleWeight: productsTable.bottleWeight,
        bottleColour: productsTable.bottleColour,
        capColour: productsTable.capColour,
        hsnCode: productsTable.hsnCode,
        pricePerUnit: productsTable.pricePerUnit,
      })
      .from(inventoryTable)
      .innerJoin(productsTable, eq(inventoryTable.productId, productsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(inventoryTable.updatedAt));

    // Search filter (post-join)
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        r.productName?.toLowerCase().includes(s) ||
        r.productCode?.toLowerCase().includes(s) ||
        r.category?.toLowerCase().includes(s)
      );
    }

    res.json(rows);
  } catch (err) {
    console.error("Get inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /inventory/logs — Fetch adjustment history ──
router.get("/inventory/logs", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { productId, unit } = req.query as Record<string, string | undefined>;
    const conditions: any[] = [];

    if (productId) conditions.push(eq(inventoryLogsTable.productId, Number(productId)));
    if (unit) conditions.push(eq(inventoryLogsTable.unitName, unit));

    const logs = await db
      .select({
        id: inventoryLogsTable.id,
        productId: inventoryLogsTable.productId,
        unitName: inventoryLogsTable.unitName,
        adjustmentType: inventoryLogsTable.adjustmentType,
        quantity: inventoryLogsTable.quantity,
        previousStock: inventoryLogsTable.previousStock,
        newStock: inventoryLogsTable.newStock,
        notes: inventoryLogsTable.notes,
        createdBy: inventoryLogsTable.createdBy,
        createdAt: inventoryLogsTable.createdAt,
        productName: productsTable.name,
      })
      .from(inventoryLogsTable)
      .innerJoin(productsTable, eq(inventoryLogsTable.productId, productsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(inventoryLogsTable.createdAt))
      .limit(200);

    res.json(logs);
  } catch (err) {
    console.error("Get inventory logs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /inventory/adjust — Add or subtract stock ──
router.patch("/inventory/adjust", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can adjust stock" });
      return;
    }

    const { productId, unitName, adjustmentType, quantity, notes } = req.body;

    if (!productId || !unitName || !adjustmentType || !quantity) {
      res.status(400).json({ error: "productId, unitName, adjustmentType, and quantity are required" });
      return;
    }

    if (adjustmentType !== "add" && adjustmentType !== "subtract") {
      res.status(400).json({ error: "adjustmentType must be 'add' or 'subtract'" });
      return;
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: "Quantity must be a positive number" });
      return;
    }

    // Find or create inventory record
    const [existing] = await db
      .select()
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.unitName, unitName)));

    const previousStock = existing?.currentStock ?? 0;
    const newStock = adjustmentType === "add" ? previousStock + qty : previousStock - qty;

    if (newStock < 0) {
      res.status(400).json({ error: `Insufficient stock. Current: ${previousStock}, Trying to subtract: ${qty}` });
      return;
    }

    if (existing) {
      await db
        .update(inventoryTable)
        .set({ currentStock: newStock, updatedAt: new Date() })
        .where(eq(inventoryTable.id, existing.id));
    } else {
      await db.insert(inventoryTable).values({
        productId,
        unitName,
        currentStock: newStock,
      });
    }

    // Log the adjustment
    await db.insert(inventoryLogsTable).values({
      productId,
      unitName,
      adjustmentType,
      quantity: qty,
      previousStock,
      newStock,
      notes: notes || null,
      createdBy: user.id,
    });

    res.json({ previousStock, newStock, adjustmentType, quantity: qty });
  } catch (err) {
    console.error("Adjust inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /inventory/bulk — Bulk set stock (for initial data entry) ──
router.post("/inventory/bulk", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify stock" });
      return;
    }

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items array is required" });
      return;
    }

    const results: { productId: number; unitName: string; previousStock: number; newStock: number }[] = [];

    for (const item of items) {
      const { productId, unitName, stock } = item;
      if (!productId || !unitName || stock === undefined) continue;

      const qty = Number(stock);
      if (isNaN(qty) || qty < 0) continue;

      const [existing] = await db
        .select()
        .from(inventoryTable)
        .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.unitName, unitName)));

      const previousStock = existing?.currentStock ?? 0;

      if (existing) {
        await db
          .update(inventoryTable)
          .set({ currentStock: qty, updatedAt: new Date() })
          .where(eq(inventoryTable.id, existing.id));
      } else {
        await db.insert(inventoryTable).values({
          productId,
          unitName,
          currentStock: qty,
        });
      }

      // Log the bulk set
      await db.insert(inventoryLogsTable).values({
        productId,
        unitName,
        adjustmentType: "set",
        quantity: qty,
        previousStock,
        newStock: qty,
        notes: "Bulk stock update",
        createdBy: user.id,
      });

      results.push({ productId, unitName, previousStock, newStock: qty });
    }

    res.json({ updated: results.length, results });
  } catch (err) {
    console.error("Bulk inventory update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
