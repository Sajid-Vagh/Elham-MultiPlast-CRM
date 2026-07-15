import { Router, type IRouter } from "express";
import { db, inventoryTable, inventoryLogsTable } from "@workspace/db";
import { eq, and, sql, desc, ilike } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function canManageInventory(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "inventory";
}

// ── GET /inventory — Fetch inventory rows for the selected unit ──
router.get("/inventory", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { unit, search } = req.query as Record<string, string | undefined>;
    const conditions: any[] = [];

    // Unit-based access control
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
      const userUnit = user.unit || "All";
      if (userUnit !== "All") {
        conditions.push(eq(inventoryTable.unitName, userUnit));
      } else if (unit) {
        conditions.push(eq(inventoryTable.unitName, unit));
      }
    }

    let rows = await db
      .select()
      .from(inventoryTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(inventoryTable.productName);

    // Search filter (post-query)
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => r.productName?.toLowerCase().includes(s));
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

    const { productName, unit } = req.query as Record<string, string | undefined>;
    const conditions: any[] = [];

    if (productName) conditions.push(ilike(inventoryLogsTable.productName, productName));
    if (unit) conditions.push(eq(inventoryLogsTable.unitName, unit));

    const logs = await db
      .select()
      .from(inventoryLogsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(inventoryLogsTable.createdAt))
      .limit(200);

    res.json(logs);
  } catch (err) {
    console.error("Get inventory logs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /inventory/save — Save a row from the Excel ledger ──
// Accepts { productName, unitName, quantity } where quantity is the FINAL QTY
router.post("/inventory/save", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify stock" });
      return;
    }

    const { id, productName, unitName, quantity } = req.body;

    if (!productName || !unitName || quantity === undefined) {
      res.status(400).json({ error: "productName, unitName, and quantity are required" });
      return;
    }

    const trimmedName = String(productName).trim();
    if (!trimmedName) {
      res.status(400).json({ error: "productName cannot be empty" });
      return;
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty < 0) {
      res.status(400).json({ error: "quantity must be a non-negative number" });
      return;
    }

    // Find existing record: by ID if provided, else by (productName, unitName)
    let existing = null;
    if (id) {
      const [row] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, Number(id)));
      existing = row || null;
    } else {
      const [row] = await db
        .select()
        .from(inventoryTable)
        .where(
          and(
            sql`lower(${inventoryTable.productName}) = lower(${trimmedName})`,
            eq(inventoryTable.unitName, unitName)
          )
        );
      existing = row || null;
    }

    const previousStock = existing?.currentStock ?? 0;

    if (existing) {
      await db
        .update(inventoryTable)
        .set({ productName: trimmedName, currentStock: qty, updatedAt: new Date() })
        .where(eq(inventoryTable.id, existing.id));
    } else {
      await db.insert(inventoryTable).values({
        productName: trimmedName,
        unitName,
        currentStock: qty,
      });
    }

    // Log the save
    await db.insert(inventoryLogsTable).values({
      productName: trimmedName,
      unitName,
      adjustmentType: "set",
      quantity: qty,
      previousStock,
      newStock: qty,
      notes: null,
      createdBy: user.id,
    });

    res.json({ productName: trimmedName, unitName, previousStock, newStock: qty });
  } catch (err) {
    console.error("Save inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /inventory/save-bulk — Save multiple rows at once ──
router.post("/inventory/save-bulk", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify stock" });
      return;
    }

    const { unitName, items } = req.body;

    if (!unitName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "unitName and items array are required" });
      return;
    }

    const results: { productName: string; previousStock: number; newStock: number }[] = [];

    for (const item of items) {
      const { productName, quantity } = item;
      if (!productName || quantity === undefined) continue;

      const trimmedName = String(productName).trim();
      if (!trimmedName) continue;

      const qty = Number(quantity);
      if (isNaN(qty) || qty < 0) continue;

      const [existing] = await db
        .select()
        .from(inventoryTable)
        .where(
          and(
            sql`lower(${inventoryTable.productName}) = lower(${trimmedName})`,
            eq(inventoryTable.unitName, unitName)
          )
        );

      const previousStock = existing?.currentStock ?? 0;

      if (existing) {
        await db
          .update(inventoryTable)
          .set({ currentStock: qty, updatedAt: new Date() })
          .where(eq(inventoryTable.id, existing.id));
      } else {
        await db.insert(inventoryTable).values({
          productName: trimmedName,
          unitName,
          currentStock: qty,
        });
      }

      await db.insert(inventoryLogsTable).values({
        productName: trimmedName,
        unitName,
        adjustmentType: "set",
        quantity: qty,
        previousStock,
        newStock: qty,
        notes: "Bulk save",
        createdBy: user.id,
      });

      results.push({ productName: trimmedName, previousStock, newStock: qty });
    }

    res.json({ saved: results.length, results });
  } catch (err) {
    console.error("Bulk save inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /inventory/:id — Delete an inventory row ──
router.delete("/inventory/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can delete stock" });
      return;
    }

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    await db.delete(inventoryTable).where(eq(inventoryTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
