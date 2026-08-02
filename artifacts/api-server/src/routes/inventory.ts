import { Router, type IRouter } from "express";
import { db, inventoryTable, inventoryLogsTable } from "@workspace/db";
import { eq, and, sql, desc, ilike } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function canManageInventory(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "inventory";
}

/**
 * Unit that the user is allowed to READ. Strict isolation:
 *   - admin: honors ?unit= (undefined = all units)
 *   - unit "All": honors ?unit= (undefined = all units)
 *   - inventory role with a real unit: ALWAYS that unit, ignores client ?unit=
 *   - sales: honors ?unit= (dropdown controls; undefined = all units)
 *   - other roles: own unit (or ?unit= if own unit is "All")
 */
function resolveReadUnit(
  user: { role: string; unit?: string | null },
  requestedUnit?: string,
): string | undefined {
  if (user.role === "admin") return requestedUnit || undefined;
  const ownUnit = user.unit || "All";
  if (ownUnit === "All") return requestedUnit || undefined;
  if (user.role === "inventory") return ownUnit; // strict, ignore requested
  if (user.role === "sales") return requestedUnit || undefined;
  return requestedUnit || ownUnit;
}

/**
 * Unit to stamp when WRITING inventory rows. The unit is read from the
 * session token, never trusted from the frontend:
 *   - admin or unit "All": honor requested unit (must be provided)
 *   - scoped users (real unit): ALWAYS forced to their own unit
 */
function resolveWriteUnit(
  user: { role: string; unit?: string | null },
  requestedUnit?: string,
): string | null {
  if (user.role === "admin") return requestedUnit || null;
  const ownUnit = user.unit || "All";
  if (ownUnit === "All") return requestedUnit || null;
  return ownUnit;
}

// ── GET /inventory — Fetch inventory rows, filtered by unit ──
router.get("/inventory", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { unit, search } = req.query as Record<string, string | undefined>;
    const conditions: any[] = [];

    // Unit-based access control (strict)
    const effectiveUnit = resolveReadUnit(user, unit);
    if (effectiveUnit) {
      conditions.push(eq(inventoryTable.unitName, effectiveUnit));
    }

    let rows = await db
      .select()
      .from(inventoryTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(inventoryTable.sortOrder, inventoryTable.id);

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    // Unit isolation (strict) for logs as well
    const effectiveUnit = resolveReadUnit(user, unit);
    if (effectiveUnit) conditions.push(eq(inventoryLogsTable.unitName, effectiveUnit));

    const logs = await db
      .select()
      .from(inventoryLogsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(inventoryLogsTable.createdAt))
      .limit(200);

    res.json(logs);
  } catch (err) {
    console.error("Get inventory logs error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── POST /inventory/save — Save a single row ──
// Body: { id?, productName, unitName, size?, bottleColor?, weight?, stock?, clientOrder?, sortOrder? }
router.post("/inventory/save", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify stock" });
      return;
    }

    const { id, productName, unitName, size, bottleColor, weight, stock, clientOrder, sortOrder } = req.body;

    // Unit always comes from the session token for scoped users; otherwise the
    // frontend-provided unit is honored (required).
    const effectiveUnit = resolveWriteUnit(user, unitName);
    if (!effectiveUnit) {
      res.status(400).json({ error: "unitName is required" });
      return;
    }

    const trimmedName = String(productName || "").trim();
    const newStock = Math.max(0, Number(stock) || 0);
    const newClientOrder = Number(clientOrder) || 0;
    const newSortOrder = sortOrder != null ? Number(sortOrder) : null;

    // Find existing record: by ID if provided, else by (productName, unitName) — only if productName is non-empty
    let existing = null;
    if (id) {
      const [row] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, Number(id)));
      existing = row || null;
    } else if (trimmedName) {
      const [row] = await db
        .select()
        .from(inventoryTable)
        .where(
          and(
            sql`lower(${inventoryTable.productName}) = lower(${trimmedName})`,
            eq(inventoryTable.unitName, effectiveUnit)
          )
        );
      existing = row || null;
    }

    const previousStock = existing?.stock ?? 0;

    if (existing) {
      await db
        .update(inventoryTable)
        .set({
          productName: trimmedName || existing.productName,
          size: size !== undefined ? size : existing.size,
          bottleColor: bottleColor !== undefined ? bottleColor : existing.bottleColor,
          weight: weight !== undefined ? weight : existing.weight,
          stock: newStock,
          clientOrder: newClientOrder,
          sortOrder: newSortOrder !== null ? newSortOrder : existing.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(inventoryTable.id, existing.id));
    } else {
      await db.insert(inventoryTable).values({
        productName: trimmedName,
        unitName: effectiveUnit,
        size: size || null,
        bottleColor: bottleColor || null,
        weight: weight || null,
        stock: newStock,
        clientOrder: newClientOrder,
        sortOrder: newSortOrder,
      });
    }

    // Log the adjustment (skip for blank rows)
    if (trimmedName && newStock !== previousStock) {
      await db.insert(inventoryLogsTable).values({
        productName: trimmedName,
        unitName: effectiveUnit,
        adjustmentType: newStock > previousStock ? "add" : "set",
        quantity: Math.abs(newStock - previousStock),
        previousStock,
        newStock,
        notes: null,
        createdBy: user.id,
      });
    }

    res.json({ productName: trimmedName, unitName: effectiveUnit, previousStock, newStock });
  } catch (err) {
    console.error("Save inventory error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── POST /inventory/save-bulk — Bulk save (for Excel import + row saves) ──
// Body: { unitName, items: [{ id?, productName, size?, bottleColor?, weight?, stock, clientOrder?, sortOrder? }] }
router.post("/inventory/save-bulk", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify stock" });
      return;
    }

    const { unitName, items } = req.body;

    // Unit from session token for scoped users; required otherwise.
    const effectiveUnit = resolveWriteUnit(user, unitName);
    if (!effectiveUnit || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "unitName and items array are required" });
      return;
    }

    const results: { productName: string; previousStock: number; newStock: number }[] = [];

    for (const item of items) {
      const { id, productName, size, bottleColor, weight, stock, clientOrder, sortOrder } = item;
      const trimmedName = String(productName || "").trim();
      const newStock = Math.max(0, Number(stock) || 0);
      const newClientOrder = Number(clientOrder) || 0;
      const newSortOrder = sortOrder != null ? Number(sortOrder) : null;

      // Find existing: by ID or by (productName, unitName) — only if productName is non-empty
      let existing = null;
      if (id) {
        const [row] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, Number(id)));
        existing = row || null;
      } else if (trimmedName) {
        const [row] = await db
          .select()
          .from(inventoryTable)
          .where(
            and(
              sql`lower(${inventoryTable.productName}) = lower(${trimmedName})`,
              eq(inventoryTable.unitName, effectiveUnit)
            )
          );
        existing = row || null;
      }

      const previousStock = existing?.stock ?? 0;

      if (existing) {
        await db
          .update(inventoryTable)
          .set({
            productName: trimmedName || existing.productName,
            size: size !== undefined ? (size || null) : existing.size,
            bottleColor: bottleColor !== undefined ? (bottleColor || null) : existing.bottleColor,
            weight: weight !== undefined ? (weight || null) : existing.weight,
            stock: newStock,
            clientOrder: newClientOrder,
            sortOrder: newSortOrder !== null ? newSortOrder : existing.sortOrder,
            updatedAt: new Date(),
          })
          .where(eq(inventoryTable.id, existing.id));
      } else {
        await db.insert(inventoryTable).values({
          productName: trimmedName,
          unitName: effectiveUnit,
          size: size || null,
          bottleColor: bottleColor || null,
          weight: weight || null,
          stock: newStock,
          clientOrder: newClientOrder,
          sortOrder: newSortOrder,
        });
      }

      if (trimmedName && newStock !== previousStock) {
        await db.insert(inventoryLogsTable).values({
          productName: trimmedName,
          unitName: effectiveUnit,
          adjustmentType: newStock > previousStock ? "import" : "set",
          quantity: Math.abs(newStock - previousStock),
          previousStock,
          newStock,
          notes: "Bulk save",
          createdBy: user.id,
        });
      }

      results.push({ productName: trimmedName || "(blank row)", previousStock, newStock });
    }

    res.json({ saved: results.length, results });
  } catch (err) {
    console.error("Bulk save inventory error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── POST /inventory/bulk-save — Save all grid rows at once (upsert) ──
// Body: { items: [{ id?, productName, unitName, size?, bottleColor?, weight?, stock, clientOrder, sortOrder?, formatting? }] }
router.post("/inventory/bulk-save", async (req, res) => {
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

    const results = await db.transaction(async (tx) => {
      const saved: { id: number | null; productName: string; action: string }[] = [];

      for (const item of items) {
        const { id, productName, unitName, size, bottleColor, weight, stock, clientOrder, sortOrder, formatting } = item;
        const trimmedName = String(productName || "").trim();
        const newStock = Math.max(0, Number(stock) || 0);
        const newClientOrder = Number(clientOrder) || 0;
        const newSortOrder = sortOrder != null ? Number(sortOrder) : null;

        // Unit always from session token for scoped users; for admin/"All"
        // users the per-item unit must be present to be written.
        const effectiveUnit = resolveWriteUnit(user, unitName);
        if (!effectiveUnit) continue;

        let existing = null;
        if (id) {
          const [row] = await tx.select().from(inventoryTable).where(eq(inventoryTable.id, Number(id)));
          existing = row || null;
        }

        const previousStock = existing?.stock ?? 0;

        if (existing) {
          await tx
            .update(inventoryTable)
            .set({
              productName: trimmedName || existing.productName,
              unitName: effectiveUnit,
              size: size !== undefined ? (size || null) : existing.size,
              bottleColor: bottleColor !== undefined ? (bottleColor || null) : existing.bottleColor,
              weight: weight !== undefined ? (weight || null) : existing.weight,
              stock: newStock,
              clientOrder: newClientOrder,
              sortOrder: newSortOrder !== null ? newSortOrder : existing.sortOrder,
              formatting: formatting !== undefined ? (formatting || null) : existing.formatting,
              updatedAt: new Date(),
            })
            .where(eq(inventoryTable.id, existing.id));

          if (trimmedName && newStock !== previousStock) {
            await tx.insert(inventoryLogsTable).values({
              productName: trimmedName,
              unitName: effectiveUnit,
              adjustmentType: newStock > previousStock ? "add" : "set",
              quantity: Math.abs(newStock - previousStock),
              previousStock,
              newStock,
              notes: "Bulk save",
              createdBy: user.id,
            });
          }

          saved.push({ id: existing.id, productName: trimmedName, action: "updated" });
        } else {
          const [inserted] = await tx
            .insert(inventoryTable)
            .values({
              productName: trimmedName,
              unitName: effectiveUnit,
              size: size || null,
              bottleColor: bottleColor || null,
              weight: weight || null,
              stock: newStock,
              clientOrder: newClientOrder,
              sortOrder: newSortOrder,
              formatting: formatting || null,
            })
            .returning({ id: inventoryTable.id });

          if (trimmedName && newStock > 0) {
            await tx.insert(inventoryLogsTable).values({
              productName: trimmedName,
              unitName: effectiveUnit,
              adjustmentType: "import",
              quantity: newStock,
              previousStock: 0,
              newStock,
              notes: "Bulk save",
              createdBy: user.id,
            });
          }

          saved.push({ id: inserted.id, productName: trimmedName, action: "inserted" });
        }
      }

      return saved;
    });

    res.json({ saved: results.length, results });
  } catch (err) {
    console.error("Bulk save inventory error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── PATCH /inventory/:id/formatting — Save row formatting ──
router.patch("/inventory/:id/formatting", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can modify formatting" });
      return;
    }

    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { formatting } = req.body;

    // Strict unit isolation: scoped users may only format rows in their own unit
    const effectiveUnit = resolveWriteUnit(user, undefined);
    if (effectiveUnit) {
      const [row] = await db
        .select({ unitName: inventoryTable.unitName })
        .from(inventoryTable)
        .where(eq(inventoryTable.id, id));
      if (!row || row.unitName !== effectiveUnit) {
        res.status(403).json({ error: "Access denied: unit mismatch" });
        return;
      }
    }

    await db
      .update(inventoryTable)
      .set({ formatting: formatting || null, updatedAt: new Date() })
      .where(eq(inventoryTable.id, id));

    res.json({ success: true });
  } catch (err) {
    console.error("Update formatting error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── DELETE /inventory/clear-all — Delete all rows for a unit (or all units) ──
// Body: { unitName? } — if unitName is provided, only deletes that unit's rows
router.delete("/inventory/clear-all", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can clear inventory" });
      return;
    }

    const { unitName } = req.query as Record<string, string | undefined>;

    // Strict unit isolation: scoped users may only clear rows in their own unit.
    const effectiveUnit = resolveWriteUnit(user, unitName);

    if (effectiveUnit) {
      const deleted = await db
        .delete(inventoryTable)
        .where(eq(inventoryTable.unitName, effectiveUnit))
        .returning({ id: inventoryTable.id });
      res.json({ success: true, deleted: deleted.length });
    } else {
      const deleted = await db
        .delete(inventoryTable)
        .returning({ id: inventoryTable.id });
      res.json({ success: true, deleted: deleted.length });
    }
  } catch (err) {
    console.error("Clear all inventory error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    // Strict unit isolation: scoped users may only delete rows in their own unit
    const effectiveUnit = resolveWriteUnit(user, undefined);
    if (effectiveUnit) {
      const [row] = await db
        .select({ unitName: inventoryTable.unitName })
        .from(inventoryTable)
        .where(eq(inventoryTable.id, id));
      if (!row || row.unitName !== effectiveUnit) {
        res.status(403).json({ error: "Access denied: unit mismatch" });
        return;
      }
    }

    await db.delete(inventoryTable).where(eq(inventoryTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete inventory error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── POST /inventory/insert-row — Insert a blank row below a given row ──
// Body: { afterId?: number, unitName: string } — if afterId is null, inserts at top
router.post("/inventory/insert-row", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!canManageInventory(user)) {
      res.status(403).json({ error: "Only inventory or admin users can insert rows" });
      return;
    }

    const { afterId, unitName } = req.body;
    // Unit always from session token for scoped users; required otherwise.
    const effectiveUnit = resolveWriteUnit(user, unitName);
    if (!effectiveUnit) {
      res.status(400).json({ error: "unitName is required" });
      return;
    }

    // Get all rows for this unit ordered by sort_order, id
    const allRows = await db
      .select({ id: inventoryTable.id, sortOrder: inventoryTable.sortOrder })
      .from(inventoryTable)
      .where(eq(inventoryTable.unitName, effectiveUnit))
      .orderBy(inventoryTable.sortOrder, inventoryTable.id);

    // Determine the sort_order for the new row
    let newSortOrder: number;
    if (!afterId) {
      // Insert at top
      const minSort = allRows.length > 0 ? (allRows[0].sortOrder ?? allRows[0].id) : 0;
      newSortOrder = minSort - 1;
    } else {
      // Insert after the given row
      const afterRow = allRows.find((r) => r.id === afterId);
      const afterIdx = allRows.findIndex((r) => r.id === afterId);
      if (afterIdx === -1) {
        res.status(404).json({ error: "Row not found" });
        return;
      }
      if (afterIdx === allRows.length - 1) {
        // Insert at end
        const maxSort = Math.max(...allRows.map((r) => r.sortOrder ?? r.id));
        newSortOrder = maxSort + 1;
      } else {
        // Insert between two rows
        const currentSort = afterRow.sortOrder ?? afterRow.id;
        const nextSort = allRows[afterIdx + 1].sortOrder ?? allRows[afterIdx + 1].id;
        newSortOrder = Math.floor((currentSort + nextSort) / 2);
      }
    }

    // Insert the blank row
    const [inserted] = await db
      .insert(inventoryTable)
      .values({
        productName: "",
        unitName: effectiveUnit,
        size: null,
        bottleColor: null,
        weight: null,
        stock: 0,
        clientOrder: 0,
        sortOrder: newSortOrder,
      })
      .returning({ id: inventoryTable.id });

    res.json({ success: true, id: inserted.id, sortOrder: newSortOrder });
  } catch (err) {
    console.error("Insert row error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
