import { Router, type IRouter } from "express";
import { db, inventoryTable, inventoryLogsTable } from "@workspace/db";
import { eq, and, sql, desc, ilike } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function canManageInventory(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "inventory" || user.role === "sales";
}

// ── GET /inventory — Fetch inventory rows, filtered by unit ──
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
    } else if (user.role === "admin" || user.role === "sales") {
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
      rows = rows.filter(r =>
        r.productName?.toLowerCase().includes(s) ||
        r.size?.toLowerCase().includes(s) ||
        r.bottleColor?.toLowerCase().includes(s) ||
        r.weight?.toLowerCase().includes(s)
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

// ── POST /inventory/save — Save a single row ──
// Body: { id?, productName, unitName, size?, bottleColor?, weight?, adjustment }
router.post("/inventory/save", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory, sales, or admin users can modify stock" });
      return;
    }

    const { id, productName, unitName, size, bottleColor, weight, adjustment } = req.body;

    if (!productName || !unitName) {
      res.status(400).json({ error: "productName and unitName are required" });
      return;
    }

    const trimmedName = String(productName).trim();
    if (!trimmedName) {
      res.status(400).json({ error: "productName cannot be empty" });
      return;
    }

    const adj = Number(adjustment) || 0;

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

    const previousStock = existing?.stock ?? 0;
    const newStock = previousStock + adj;

    if (newStock < 0) {
      res.status(400).json({ error: "Stock cannot go below zero" });
      return;
    }

    if (existing) {
      await db
        .update(inventoryTable)
        .set({
          productName: trimmedName,
          size: size !== undefined ? size : existing.size,
          bottleColor: bottleColor !== undefined ? bottleColor : existing.bottleColor,
          weight: weight !== undefined ? weight : existing.weight,
          stock: newStock,
          orderQty: 0,
          updatedAt: new Date(),
        })
        .where(eq(inventoryTable.id, existing.id));
    } else {
      await db.insert(inventoryTable).values({
        productName: trimmedName,
        unitName,
        size: size || null,
        bottleColor: bottleColor || null,
        weight: weight || null,
        stock: newStock,
        orderQty: 0,
      });
    }

    // Log the adjustment
    if (adj !== 0) {
      await db.insert(inventoryLogsTable).values({
        productName: trimmedName,
        unitName,
        adjustmentType: adj > 0 ? "add" : "subtract",
        quantity: Math.abs(adj),
        previousStock,
        newStock,
        notes: null,
        createdBy: user.id,
      });
    }

    res.json({ productName: trimmedName, unitName, previousStock, newStock });
  } catch (err) {
    console.error("Save inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /inventory/save-bulk — Bulk save (for Excel import + row saves) ──
// Body: { unitName, items: [{ id?, productName, size?, bottleColor?, weight?, stock, adjustment? }] }
router.post("/inventory/save-bulk", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory, sales, or admin users can modify stock" });
      return;
    }

    const { unitName, items } = req.body;

    if (!unitName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "unitName and items array are required" });
      return;
    }

    const results: { productName: string; previousStock: number; newStock: number }[] = [];

    for (const item of items) {
      const { id, productName, size, bottleColor, weight, stock, adjustment } = item;
      if (!productName) continue;

      const trimmedName = String(productName).trim();
      if (!trimmedName) continue;

      // Find existing: by ID or by (productName, unitName)
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

      const previousStock = existing?.stock ?? 0;

      let newStock: number;
      if (stock !== undefined && adjustment === undefined) {
        // Direct stock set (from import)
        newStock = Math.max(0, Number(stock) || 0);
      } else {
        // Adjustment mode
        const adj = Number(adjustment) || 0;
        newStock = Math.max(0, previousStock + adj);
      }

      if (existing) {
        await db
          .update(inventoryTable)
          .set({
            productName: trimmedName,
            size: size !== undefined ? (size || null) : existing.size,
            bottleColor: bottleColor !== undefined ? (bottleColor || null) : existing.bottleColor,
            weight: weight !== undefined ? (weight || null) : existing.weight,
            stock: newStock,
            orderQty: 0,
            updatedAt: new Date(),
          })
          .where(eq(inventoryTable.id, existing.id));
      } else {
        await db.insert(inventoryTable).values({
          productName: trimmedName,
          unitName,
          size: size || null,
          bottleColor: bottleColor || null,
          weight: weight || null,
          stock: newStock,
          orderQty: 0,
        });
      }

      if (newStock !== previousStock) {
        await db.insert(inventoryLogsTable).values({
          productName: trimmedName,
          unitName,
          adjustmentType: newStock > previousStock ? "import" : "set",
          quantity: Math.abs(newStock - previousStock),
          previousStock,
          newStock,
          notes: "Bulk save",
          createdBy: user.id,
        });
      }

      results.push({ productName: trimmedName, previousStock, newStock });
    }

    res.json({ saved: results.length, results });
  } catch (err) {
    console.error("Bulk save inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /inventory/:id/formatting — Save row formatting ──
router.patch("/inventory/:id/formatting", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory, sales, or admin users can modify formatting" });
      return;
    }

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { formatting } = req.body;

    await db
      .update(inventoryTable)
      .set({ formatting: formatting || null, updatedAt: new Date() })
      .where(eq(inventoryTable.id, id));

    res.json({ success: true });
  } catch (err) {
    console.error("Update formatting error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /inventory/:id — Delete an inventory row ──
router.delete("/inventory/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory, sales, or admin users can delete stock" });
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
