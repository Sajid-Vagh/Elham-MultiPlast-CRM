import { Router, type IRouter } from "express";
import { db, productBundleMasterTable, transportDestinationMasterTable, importBatchesTable, auditLogsTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, and, sql, ilike, or, isNull, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { canManageMaster, canImportMaster, canUndoImport, type PermissionUser } from "../lib/permission-service";

const router: IRouter = Router();

// ── Helpers ──

function authUser(req: any): Promise<PermissionUser | null> {
  return getUserFromRequest(req) as Promise<PermissionUser | null>;
}

function getVisibleUnits(user: PermissionUser): string[] | null {
  if (user.role === "admin" || user.role === "production_and_support") return null;
  if (user.unit === "Himatnagar") return null;
  if (user.unit === "Surat" || user.unit === "Rajkot") return [user.unit];
  return [];
}

function unitFilterDest(userUnit: string | null | undefined) {
  if (!userUnit || userUnit === "Himatnagar" || userUnit === "admin" || userUnit === "production_and_support") return undefined;
  return or(
    eq(transportDestinationMasterTable.productionUnit, userUnit),
    isNull(transportDestinationMasterTable.productionUnit),
  );
}

function unitFilterBundle(userUnit: string | null | undefined) {
  if (!userUnit || userUnit === "Himatnagar" || userUnit === "admin" || userUnit === "production_and_support") return undefined;
  return or(
    eq(productBundleMasterTable.productionUnit, userUnit),
    isNull(productBundleMasterTable.productionUnit),
  );
}

async function logAudit(entityType: string, entityId: number, action: string, oldValue: any, newValue: any, userId: number) {
  try {
    await db.insert(auditLogsTable).values({
      entityType,
      entityId,
      action,
      oldValue: oldValue || null,
      newValue: newValue || null,
      changedBy: userId,
    });
  } catch (e) {
    console.error("Audit log error:", e);
  }
}

// ══════════════════════════════════════════════════════════════
// TRANSPORT DESTINATION MASTER CRUD
// ══════════════════════════════════════════════════════════════

// List destinations with search (PIN, city, state, company, unit)
router.get("/transport-masters/destinations", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, state, city, pinCode, transportCompany, page = "1", limit = "50", unit } = req.query as Record<string, string>;
    const conditions: any[] = [eq(transportDestinationMasterTable.isActive, true)];

    if (pinCode) conditions.push(eq(transportDestinationMasterTable.pinCode, pinCode));
    if (state) conditions.push(ilike(transportDestinationMasterTable.state, `%${state}%`));
    if (city) conditions.push(ilike(transportDestinationMasterTable.city, `%${city}%`));
    if (transportCompany) conditions.push(ilike(transportDestinationMasterTable.transportCompany, `%${transportCompany}%`));
    if (search) {
      conditions.push(or(
        ilike(transportDestinationMasterTable.state, `%${search}%`),
        ilike(transportDestinationMasterTable.city, `%${search}%`),
        ilike(transportDestinationMasterTable.pinCode, `%${search}%`),
        ilike(transportDestinationMasterTable.transportCompany, `%${search}%`),
      ));
    }

    // Unit-based RBAC
    if (unit && unit !== "all") {
      conditions.push(or(
        eq(transportDestinationMasterTable.productionUnit, unit),
        isNull(transportDestinationMasterTable.productionUnit),
      ));
    } else {
      const visibleUnits = getVisibleUnits(user);
      if (visibleUnits !== null && visibleUnits.length === 0) {
        conditions.push(isNull(transportDestinationMasterTable.productionUnit));
      }
    }

    const where = and(...conditions);
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(transportDestinationMasterTable).where(where);
    const data = await db.select().from(transportDestinationMasterTable)
      .where(where)
      .orderBy(transportDestinationMasterTable.state, transportDestinationMasterTable.city, transportDestinationMasterTable.transportCompany)
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.count ?? 0,
        totalPages: Math.ceil((countResult?.count ?? 0) / limitNum),
      },
    });
  } catch (err) {
    console.error("List destinations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PIN-first transport lookup: PIN → City → State
router.get("/transport-masters/destinations/lookup", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { pinCode, city, state, productionUnit } = req.query as Record<string, string>;
    const activeOnly = eq(transportDestinationMasterTable.isActive, true);

    // If no search params, return all active destinations
    if (!pinCode && !city && !state) {
      const conditions: any[] = [activeOnly];
      if (productionUnit) {
        conditions.push(or(
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
          isNull(transportDestinationMasterTable.productionUnit),
        ));
      }
      const results = await db.select().from(transportDestinationMasterTable)
        .where(and(...conditions))
        .orderBy(transportDestinationMasterTable.productionUnit, transportDestinationMasterTable.city);
      res.json({ data: results });
      return;
    }

    // Priority 1: PIN code match
    if (pinCode) {
      const conditions: any[] = [activeOnly, eq(transportDestinationMasterTable.pinCode, pinCode)];
      if (productionUnit) {
        conditions.push(or(
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
          isNull(transportDestinationMasterTable.productionUnit),
        ));
      }
      const results = await db.select().from(transportDestinationMasterTable)
        .where(and(...conditions))
        .orderBy(transportDestinationMasterTable.transportCharge);
      if (results.length > 0) {
        res.json({ matchedBy: "pinCode", data: results });
        return;
      }
    }

    // Priority 2: City match
    if (city) {
      const conditions: any[] = [activeOnly, ilike(transportDestinationMasterTable.city, city)];
      if (productionUnit) {
        conditions.push(or(
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
          isNull(transportDestinationMasterTable.productionUnit),
        ));
      }
      const results = await db.select().from(transportDestinationMasterTable)
        .where(and(...conditions))
        .orderBy(transportDestinationMasterTable.transportCharge);
      if (results.length > 0) {
        res.json({ matchedBy: "city", data: results });
        return;
      }
    }

    // Priority 3: State match
    if (state) {
      const conditions: any[] = [activeOnly, ilike(transportDestinationMasterTable.state, state)];
      if (productionUnit) {
        conditions.push(or(
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
          isNull(transportDestinationMasterTable.productionUnit),
        ));
      }
      const results = await db.select().from(transportDestinationMasterTable)
        .where(and(...conditions))
        .orderBy(transportDestinationMasterTable.transportCharge);
      if (results.length > 0) {
        res.json({ matchedBy: "state", data: results });
        return;
      }
    }

    res.json({ matchedBy: null, data: [] });
  } catch (err) {
    console.error("Transport lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create destination (admin/inventory only)
router.post("/transport-masters/destinations", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { state, city, pinCode, transportCompany, transportType, transportCharge, transitDays, productionUnit, remarks } = req.body;
    if (!state || !city) {
      res.status(400).json({ error: "State and city are required" }); return;
    }

    const [created] = await db.insert(transportDestinationMasterTable).values({
      state: state.trim(),
      city: city.trim(),
      pinCode: pinCode?.trim() || null,
      transportCompany: transportCompany?.trim() || null,
      transportType: transportType?.trim() || "Bundle Wise",
      transportCharge: String(transportCharge || 0),
      transitDays: transitDays ? Number(transitDays) : null,
      productionUnit: productionUnit && productionUnit !== "all" ? productionUnit : null,
      remarks: remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update destination (admin/inventory only) with audit
router.patch("/transport-masters/destinations/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { updatedAt: new Date(), updatedBy: user.id };
    const fields = ["state", "city", "pinCode", "transportCompany", "transportType", "transitDays", "remarks", "isActive", "productionUnit",
      "transportZone", "distanceKm", "weightSlabMin", "weightSlabMax", "vehicleType", "minFreight", "maxFreight"];
    for (const f of fields) {
      const dbCol = f.replace(/([A-Z])/g, "_$1").toLowerCase();
      if (req.body[f] !== undefined) {
        updateData[dbCol] = f === "isActive" ? req.body[f] : (typeof req.body[f] === "string" ? req.body[f].trim() : req.body[f]);
        if (f === "productionUnit") updateData[dbCol] = req.body[f] && req.body[f] !== "all" ? req.body[f] : null;
        if (f === "transitDays" || f === "weightSlabMin" || f === "weightSlabMax") updateData[dbCol] = req.body[f] ? Number(req.body[f]) : null;
      }
    }
    if (req.body.transportCharge !== undefined) updateData.transport_charge = String(req.body.transportCharge);
    if (req.body.minFreight !== undefined) updateData.min_freight = req.body.minFreight ? String(req.body.minFreight) : null;
    if (req.body.maxFreight !== undefined) updateData.max_freight = req.body.maxFreight ? String(req.body.maxFreight) : null;

    const [updated] = await db.update(transportDestinationMasterTable).set(updateData).where(eq(transportDestinationMasterTable.id, id)).returning();

    // Audit trail
    await logAudit("transport_master", id, "update", existing, updated, user.id);

    res.json(updated);
  } catch (err) {
    console.error("Update destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete destination (admin only)
router.delete("/transport-masters/destinations/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    await logAudit("transport_master", id, "delete", existing, null, user.id);
    res.status(204).send();
  } catch (err) {
    console.error("Delete destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get audit history for a destination
router.get("/transport-masters/destinations/history/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const logs = await db.select().from(auditLogsTable)
      .where(and(eq(auditLogsTable.entityType, "transport_master"), eq(auditLogsTable.entityId, id)))
      .orderBy(desc(auditLogsTable.createdAt));

    res.json(logs);
  } catch (err) {
    console.error("Transport history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Customer transport suggestion: last used transport from order snapshots
router.get("/transport-masters/destinations/customer-suggest/:contactId", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    const recentOrders = await db.select({
      transportCompany: ordersTable.transportCompany,
      freight: ordersTable.freight,
      freightChargeSnapshot: ordersTable.freightChargeSnapshot,
      transitDaysSnapshot: ordersTable.transitDaysSnapshot,
      transportMasterId: ordersTable.transportMasterId,
    }).from(ordersTable)
      .where(and(eq(ordersTable.contactId, contactId), eq(ordersTable.isDeleted, false)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(5);

    // Deduplicate by transportCompany, return most recent first
    const seen = new Set<string>();
    const suggestions = recentOrders.filter(o => {
      if (!o.transportCompany || seen.has(o.transportCompany)) return false;
      seen.add(o.transportCompany);
      return true;
    });

    res.json(suggestions);
  } catch (err) {
    console.error("Customer suggest error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// TRANSPORT MASTER IMPORT
// ══════════════════════════════════════════════════════════════

// Preview import: validate rows without writing
router.post("/transport-masters/destinations/import/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: "Maximum 1000 rows per import" }); return;
    }

    const errors: { row: number; field: string; message: string }[] = [];
    const warnings: { row: number; field: string; message: string }[] = [];
    const valid: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      let rowValid = true;

      if (!row.state?.trim()) { errors.push({ row: rowNum, field: "state", message: "State is required" }); rowValid = false; }
      if (!row.city?.trim()) { errors.push({ row: rowNum, field: "city", message: "City is required" }); rowValid = false; }
      if (!row.transportCompany?.trim()) { errors.push({ row: rowNum, field: "transportCompany", message: "Transport Name is required" }); rowValid = false; }
      if (row.transportCharge !== undefined && row.transportCharge !== "" && isNaN(Number(row.transportCharge))) {
        errors.push({ row: rowNum, field: "transportCharge", message: "Invalid charge" }); rowValid = false;
      }
      if (row.transportCharge !== undefined && row.transportCharge !== "" && Number(row.transportCharge) < 0) {
        errors.push({ row: rowNum, field: "transportCharge", message: "Charge cannot be negative" }); rowValid = false;
      }
      if (row.pinCode && !/^\d{6}$/.test(String(row.pinCode).trim())) {
        warnings.push({ row: rowNum, field: "pinCode", message: "PIN code should be 6 digits" });
      }
      if (rowValid) valid.push({ ...row, _rowNum: rowNum });
    }

    res.json({
      summary: { total: rows.length, valid: valid.length, invalid: rows.length - valid.length },
      errors,
      warnings,
      validRows: valid,
      fileName: fileName || "unknown.xlsx",
    });
  } catch (err) {
    console.error("Transport import preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Execute import: insert valid rows
router.post("/transport-masters/destinations/import/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }

    // Create import batch
    const [batch] = await db.insert(importBatchesTable).values({
      entityType: "transport_master",
      importedBy: user.id,
      fileName: fileName || "unknown.xlsx",
      rowCount: rows.length,
      successCount: 0,
      errorCount: 0,
    }).returning();

    let successCount = 0;
    const importErrors: { row: number; field: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        await db.insert(transportDestinationMasterTable).values({
          state: (row.state || "").trim(),
          city: (row.city || "").trim(),
          pinCode: row.pinCode?.trim() || null,
          transportCompany: row.transportCompany?.trim() || null,
          transportType: row.transportType?.trim() || "Bundle Wise",
          transportCharge: String(row.transportCharge || 0),
          transitDays: row.transitDays ? Number(row.transitDays) : null,
          productionUnit: row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null,
          remarks: row.remarks?.trim() || null,
          createdBy: user.id,
          updatedBy: user.id,
          importBatchId: batch.id,
        });
        successCount++;
      } catch (e: any) {
        importErrors.push({ row: rowNum, field: "database", message: e.message || "Insert failed" });
      }
    }

    // Update batch with results
    await db.update(importBatchesTable).set({
      successCount,
      errorCount: importErrors.length,
      report: { errors: importErrors, fileName },
    }).where(eq(importBatchesTable.id, batch.id));

    await logAudit("import_batch", batch.id, "import", null, { entityType: "transport_master", rowCount: rows.length, successCount, errorCount: importErrors.length }, user.id);

    res.json({ batchId: batch.id, imported: successCount, errors: importErrors });
  } catch (err) {
    console.error("Transport import execute error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Undo last import
router.post("/transport-masters/destinations/import/undo", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canUndoImport(user)) { res.status(403).json({ error: "Admin only" }); return; }

    // Find last non-undone transport import batch
    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.entityType, "transport_master"),
        sql`${importBatchesTable.undoneAt} IS NULL`,
      ))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    if (!lastBatch) {
      res.status(404).json({ error: "No import to undo" }); return;
    }

    // Delete imported rows
    const deleted = await db.delete(transportDestinationMasterTable)
      .where(eq(transportDestinationMasterTable.importBatchId, lastBatch.id))
      .returning();

    // Mark batch as undone
    await db.update(importBatchesTable).set({
      undoneAt: new Date(),
      undoneBy: user.id,
    }).where(eq(importBatchesTable.id, lastBatch.id));

    await logAudit("import_batch", lastBatch.id, "undo", null, { deletedCount: deleted.length }, user.id);

    res.json({ undone: deleted.length, batchId: lastBatch.id });
  } catch (err) {
    console.error("Transport import undo error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get last import batch for status display
router.get("/transport-masters/destinations/import/last", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const entityType = (req.query.entityType as string) || "transport_master";
    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(eq(importBatchesTable.entityType, entityType))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    res.json(lastBatch || null);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// PRODUCT BUNDLE MASTER CRUD
// ══════════════════════════════════════════════════════════════

// List bundles with search
router.get("/transport-masters/bundles", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, page = "1", limit = "50", unit } = req.query as Record<string, string>;
    const conditions: any[] = [eq(productBundleMasterTable.isActive, true)];

    if (search) {
      conditions.push(ilike(productBundleMasterTable.productName, `%${search}%`));
    }

    if (unit && unit !== "all") {
      conditions.push(or(
        eq(productBundleMasterTable.productionUnit, unit),
        isNull(productBundleMasterTable.productionUnit),
      ));
    } else {
      const visibleUnits = getVisibleUnits(user);
      if (visibleUnits !== null && visibleUnits.length === 0) {
        conditions.push(isNull(productBundleMasterTable.productionUnit));
      }
    }

    const where = and(...conditions);
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(productBundleMasterTable).where(where);
    const data = await db.select().from(productBundleMasterTable)
      .where(where)
      .orderBy(productBundleMasterTable.productName)
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.count ?? 0,
        totalPages: Math.ceil((countResult?.count ?? 0) / limitNum),
      },
    });
  } catch (err) {
    console.error("List bundles error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bundle lookup: auto-fill packing for a product
router.get("/transport-masters/bundles/lookup", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { productName, productionUnit } = req.query as Record<string, string>;
    if (!productName) {
      res.status(400).json({ error: "productName is required" }); return;
    }

    // Prefer unit-specific, fallback to shared
    if (productionUnit) {
      const [bundle] = await db.select().from(productBundleMasterTable)
        .where(and(
          ilike(productBundleMasterTable.productName, productName),
          eq(productBundleMasterTable.isActive, true),
          eq(productBundleMasterTable.productionUnit, productionUnit),
        )).limit(1);
      if (bundle) { res.json(bundle); return; }
    }

    const [bundle] = await db.select().from(productBundleMasterTable)
      .where(and(
        ilike(productBundleMasterTable.productName, productName),
        eq(productBundleMasterTable.isActive, true),
        isNull(productBundleMasterTable.productionUnit),
      )).limit(1);

    res.json(bundle || null);
  } catch (err) {
    console.error("Bundle lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create bundle (admin/inventory only)
router.post("/transport-masters/bundles", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { productName, productId, bundleSize, linerPackingQty, tciBoraQty, normalBoraQty, productionUnit, remarks } = req.body;
    if (!productName) {
      res.status(400).json({ error: "Product name is required" }); return;
    }

    const [created] = await db.insert(productBundleMasterTable).values({
      productName: productName.trim(),
      productId: productId || null,
      bundleSize: Number(bundleSize || 80),
      linerPackingQty: Number(linerPackingQty || 0),
      tciBoraQty: Number(tciBoraQty || 0),
      normalBoraQty: Number(normalBoraQty || 0),
      productionUnit: productionUnit && productionUnit !== "all" ? productionUnit : null,
      remarks: remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update bundle (admin/inventory only) with audit
router.patch("/transport-masters/bundles/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { updatedAt: new Date(), updatedBy: user.id };
    if (req.body.productName !== undefined) updateData.product_name = req.body.productName.trim();
    if (req.body.bundleSize !== undefined) updateData.bundle_size = Number(req.body.bundleSize);
    if (req.body.linerPackingQty !== undefined) updateData.liner_packing_qty = Number(req.body.linerPackingQty);
    if (req.body.tciBoraQty !== undefined) updateData.tci_bora_qty = Number(req.body.tciBoraQty);
    if (req.body.normalBoraQty !== undefined) updateData.normal_bora_qty = Number(req.body.normalBoraQty);
    if (req.body.isActive !== undefined) updateData.is_active = req.body.isActive;
    if (req.body.productionUnit !== undefined) updateData.production_unit = req.body.productionUnit && req.body.productionUnit !== "all" ? req.body.productionUnit : null;
    if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks?.trim() || null;

    const [updated] = await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, id)).returning();

    await logAudit("packing_master", id, "update", existing, updated, user.id);

    res.json(updated);
  } catch (err) {
    console.error("Update bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete bundle (admin only)
router.delete("/transport-masters/bundles/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    await logAudit("packing_master", id, "delete", existing, null, user.id);
    res.status(204).send();
  } catch (err) {
    console.error("Delete bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bundle audit history
router.get("/transport-masters/bundles/history/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const logs = await db.select().from(auditLogsTable)
      .where(and(eq(auditLogsTable.entityType, "packing_master"), eq(auditLogsTable.entityId, id)))
      .orderBy(desc(auditLogsTable.createdAt));

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// PACKING MASTER IMPORT
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: "Maximum 1000 rows per import" }); return;
    }

    const errors: { row: number; field: string; message: string }[] = [];
    const warnings: { row: number; field: string; message: string }[] = [];
    const valid: any[] = [];

    function normProd(name: string): string {
      return name.toLowerCase().trim().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\b(bottle|bottles)\b/g, "").replace(/(\d)([a-z])/g, "$1 $2").replace(/\s+/g, " ").trim();
    }
    const seenProducts = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      let rowValid = true;

      if (!row.productName?.trim()) { errors.push({ row: rowNum, field: "productName", message: "Product name is required" }); rowValid = false; }
      if (row.linerPackingQty !== undefined && row.linerPackingQty !== "" && isNaN(Number(row.linerPackingQty))) {
        errors.push({ row: rowNum, field: "linerPackingQty", message: "Invalid quantity" }); rowValid = false;
      }
      if (row.tciBoraQty !== undefined && row.tciBoraQty !== "" && isNaN(Number(row.tciBoraQty))) {
        errors.push({ row: rowNum, field: "tciBoraQty", message: "Invalid quantity" }); rowValid = false;
      }
      if (row.normalBoraQty !== undefined && row.normalBoraQty !== "" && isNaN(Number(row.normalBoraQty))) {
        errors.push({ row: rowNum, field: "normalBoraQty", message: "Invalid quantity" }); rowValid = false;
      }
      if (rowValid) {
        if (row.productName) {
          const normalized = normProd(String(row.productName).trim());
          const existingRow = seenProducts.get(normalized);
          if (existingRow) {
            warnings.push({ row: rowNum, field: "productName", message: `Similar to row ${existingRow}: "${row.productName}"` });
          } else {
            seenProducts.set(normalized, rowNum);
          }
        }
        valid.push({ ...row, _rowNum: rowNum });
      }
    }

    res.json({
      summary: { total: rows.length, valid: valid.length, invalid: rows.length - valid.length },
      errors,
      warnings,
      validRows: valid,
      fileName: fileName || "unknown.xlsx",
    });
  } catch (err) {
    console.error("Packing import preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }

    const [batch] = await db.insert(importBatchesTable).values({
      entityType: "packing_master",
      importedBy: user.id,
      fileName: fileName || "unknown.xlsx",
      rowCount: rows.length,
      successCount: 0,
      errorCount: 0,
    }).returning();

    let successCount = 0;
    const importErrors: { row: number; field: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        await db.insert(productBundleMasterTable).values({
          productName: (row.productName || "").trim(),
          productId: row.productId ? Number(row.productId) : null,
          bundleSize: Number(row.bundleSize || row.linerPackingQty || 80),
          linerPackingQty: Number(row.linerPackingQty || 0),
          tciBoraQty: Number(row.tciBoraQty || 0),
          normalBoraQty: Number(row.normalBoraQty || 0),
          productionUnit: row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null,
          remarks: row.remarks?.trim() || null,
          createdBy: user.id,
          updatedBy: user.id,
          importBatchId: batch.id,
        });
        successCount++;
      } catch (e: any) {
        importErrors.push({ row: rowNum, field: "database", message: e.message || "Insert failed" });
      }
    }

    await db.update(importBatchesTable).set({
      successCount,
      errorCount: importErrors.length,
      report: { errors: importErrors, fileName },
    }).where(eq(importBatchesTable.id, batch.id));

    await logAudit("import_batch", batch.id, "import", null, { entityType: "packing_master", rowCount: rows.length, successCount, errorCount: importErrors.length }, user.id);

    res.json({ batchId: batch.id, imported: successCount, errors: importErrors });
  } catch (err) {
    console.error("Packing import execute error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/undo", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canUndoImport(user)) { res.status(403).json({ error: "Admin only" }); return; }

    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.entityType, "packing_master"),
        sql`${importBatchesTable.undoneAt} IS NULL`,
      ))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    if (!lastBatch) {
      res.status(404).json({ error: "No import to undo" }); return;
    }

    const deleted = await db.delete(productBundleMasterTable)
      .where(eq(productBundleMasterTable.importBatchId, lastBatch.id))
      .returning();

    await db.update(importBatchesTable).set({ undoneAt: new Date(), undoneBy: user.id })
      .where(eq(importBatchesTable.id, lastBatch.id));

    await logAudit("import_batch", lastBatch.id, "undo", null, { deletedCount: deleted.length }, user.id);

    res.json({ undone: deleted.length, batchId: lastBatch.id });
  } catch (err) {
    console.error("Packing import undo error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transport-masters/bundles/import/last", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const entityType = (req.query.entityType as string) || "packing_master";
    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(eq(importBatchesTable.entityType, entityType))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    res.json(lastBatch || null);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// LINER PACKING IMPORT (upsert: update linerPackingQty only)
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/liner/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: "Maximum 1000 rows per import" }); return;
    }

    const errors: { row: number; field: string; message: string }[] = [];
    const warnings: { row: number; field: string; message: string }[] = [];
    const valid: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      let rowValid = true;

      if (!row.productName?.trim()) { errors.push({ row: rowNum, field: "productName", message: "Product name is required" }); rowValid = false; }
      if (row.linerPackingQty === undefined || row.linerPackingQty === "" || isNaN(Number(row.linerPackingQty))) {
        errors.push({ row: rowNum, field: "linerPackingQty", message: "Liner Qty is required" }); rowValid = false;
      }
      if (rowValid) valid.push({ ...row, _rowNum: rowNum });
    }

    res.json({
      summary: { total: rows.length, valid: valid.length, invalid: rows.length - valid.length },
      errors,
      warnings,
      validRows: valid,
      fileName: fileName || "unknown.xlsx",
    });
  } catch (err) {
    console.error("Liner import preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/liner/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }

    const [batch] = await db.insert(importBatchesTable).values({
      entityType: "liner_master",
      importedBy: user.id,
      fileName: fileName || "unknown.xlsx",
      rowCount: rows.length,
      successCount: 0,
      errorCount: 0,
    }).returning();

    let successCount = 0;
    const importErrors: { row: number; field: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const productName = (row.productName || "").trim();
        const productionUnit = row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null;
        const linerQty = Number(row.linerPackingQty || 0);
        const bundleSize = row.bundleSize ? Number(row.bundleSize) : undefined;

        // Upsert: find existing product by name
        const conditions: any[] = [
          eq(productBundleMasterTable.productName, productName),
          eq(productBundleMasterTable.isActive, true),
        ];
        if (productionUnit) {
          conditions.push(eq(productBundleMasterTable.productionUnit, productionUnit));
        } else {
          conditions.push(isNull(productBundleMasterTable.productionUnit));
        }
        const [existing] = await db.select().from(productBundleMasterTable).where(and(...conditions)).limit(1);

        if (existing) {
          const updateData: any = { liner_packing_qty: linerQty, updatedAt: new Date(), updatedBy: user.id, importBatchId: batch.id };
          if (bundleSize !== undefined) updateData.bundle_size = bundleSize;
          await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, existing.id));
        } else {
          await db.insert(productBundleMasterTable).values({
            productName,
            bundleSize: bundleSize ?? 80,
            linerPackingQty: linerQty,
            tciBoraQty: 0,
            normalBoraQty: 0,
            productionUnit,
            createdBy: user.id,
            updatedBy: user.id,
            importBatchId: batch.id,
          });
        }
        successCount++;
      } catch (e: any) {
        importErrors.push({ row: rowNum, field: "database", message: e.message || "Insert failed" });
      }
    }

    await db.update(importBatchesTable).set({
      successCount,
      errorCount: importErrors.length,
      report: { errors: importErrors, fileName },
    }).where(eq(importBatchesTable.id, batch.id));

    await logAudit("import_batch", batch.id, "import", null, { entityType: "liner_master", rowCount: rows.length, successCount, errorCount: importErrors.length }, user.id);

    res.json({ batchId: batch.id, imported: successCount, errors: importErrors });
  } catch (err) {
    console.error("Liner import execute error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/liner/undo", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canUndoImport(user)) { res.status(403).json({ error: "Admin only" }); return; }

    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.entityType, "liner_master"),
        sql`${importBatchesTable.undoneAt} IS NULL`,
      ))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    if (!lastBatch) {
      res.status(404).json({ error: "No import to undo" }); return;
    }

    // Undo liner imports: delete rows created by this batch
    const deleted = await db.delete(productBundleMasterTable)
      .where(eq(productBundleMasterTable.importBatchId, lastBatch.id))
      .returning();

    await db.update(importBatchesTable).set({ undoneAt: new Date(), undoneBy: user.id })
      .where(eq(importBatchesTable.id, lastBatch.id));

    await logAudit("import_batch", lastBatch.id, "undo", null, { deletedCount: deleted.length }, user.id);

    res.json({ undone: deleted.length, batchId: lastBatch.id });
  } catch (err) {
    console.error("Liner import undo error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// BORA PACKING IMPORT (upsert: update tciBoraQty + normalBoraQty only)
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/bora/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    if (rows.length > 1000) {
      res.status(400).json({ error: "Maximum 1000 rows per import" }); return;
    }

    const errors: { row: number; field: string; message: string }[] = [];
    const warnings: { row: number; field: string; message: string }[] = [];
    const valid: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      let rowValid = true;

      if (!row.productName?.trim()) { errors.push({ row: rowNum, field: "productName", message: "Product name is required" }); rowValid = false; }
      const hasTci = row.tciBoraQty !== undefined && row.tciBoraQty !== "" && !isNaN(Number(row.tciBoraQty));
      const hasNormal = row.normalBoraQty !== undefined && row.normalBoraQty !== "" && !isNaN(Number(row.normalBoraQty));
      if (!hasTci && !hasNormal) {
        errors.push({ row: rowNum, field: "boraQty", message: "At least one of TCI Bora or Normal Bora is required" }); rowValid = false;
      }
      if (hasTci && isNaN(Number(row.tciBoraQty))) {
        errors.push({ row: rowNum, field: "tciBoraQty", message: "Invalid TCI Bora quantity" }); rowValid = false;
      }
      if (hasNormal && isNaN(Number(row.normalBoraQty))) {
        errors.push({ row: rowNum, field: "normalBoraQty", message: "Invalid Normal Bora quantity" }); rowValid = false;
      }
      if (rowValid) valid.push({ ...row, _rowNum: rowNum });
    }

    res.json({
      summary: { total: rows.length, valid: valid.length, invalid: rows.length - valid.length },
      errors,
      warnings,
      validRows: valid,
      fileName: fileName || "unknown.xlsx",
    });
  } catch (err) {
    console.error("Bora import preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/bora/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportMaster(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName } = req.body as { rows: any[]; fileName?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }

    const [batch] = await db.insert(importBatchesTable).values({
      entityType: "bora_master",
      importedBy: user.id,
      fileName: fileName || "unknown.xlsx",
      rowCount: rows.length,
      successCount: 0,
      errorCount: 0,
    }).returning();

    let successCount = 0;
    const importErrors: { row: number; field: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const productName = (row.productName || "").trim();
        const productionUnit = row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null;
        const tciBora = row.tciBoraQty !== undefined && row.tciBoraQty !== "" ? Number(row.tciBoraQty) : 0;
        const normalBora = row.normalBoraQty !== undefined && row.normalBoraQty !== "" ? Number(row.normalBoraQty) : 0;
        const bundleSize = row.bundleSize ? Number(row.bundleSize) : undefined;

        // Upsert: find existing product by name
        const conditions: any[] = [
          eq(productBundleMasterTable.productName, productName),
          eq(productBundleMasterTable.isActive, true),
        ];
        if (productionUnit) {
          conditions.push(eq(productBundleMasterTable.productionUnit, productionUnit));
        } else {
          conditions.push(isNull(productBundleMasterTable.productionUnit));
        }
        const [existing] = await db.select().from(productBundleMasterTable).where(and(...conditions)).limit(1);

        if (existing) {
          const updateData: any = { tci_bora_qty: tciBora, normal_bora_qty: normalBora, updatedAt: new Date(), updatedBy: user.id, importBatchId: batch.id };
          if (bundleSize !== undefined) updateData.bundle_size = bundleSize;
          await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, existing.id));
        } else {
          await db.insert(productBundleMasterTable).values({
            productName,
            bundleSize: bundleSize ?? 80,
            linerPackingQty: 0,
            tciBoraQty: tciBora,
            normalBoraQty: normalBora,
            productionUnit,
            createdBy: user.id,
            updatedBy: user.id,
            importBatchId: batch.id,
          });
        }
        successCount++;
      } catch (e: any) {
        importErrors.push({ row: rowNum, field: "database", message: e.message || "Insert failed" });
      }
    }

    await db.update(importBatchesTable).set({
      successCount,
      errorCount: importErrors.length,
      report: { errors: importErrors, fileName },
    }).where(eq(importBatchesTable.id, batch.id));

    await logAudit("import_batch", batch.id, "import", null, { entityType: "bora_master", rowCount: rows.length, successCount, errorCount: importErrors.length }, user.id);

    res.json({ batchId: batch.id, imported: successCount, errors: importErrors });
  } catch (err) {
    console.error("Bora import execute error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transport-masters/bundles/import/bora/undo", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canUndoImport(user)) { res.status(403).json({ error: "Admin only" }); return; }

    const [lastBatch] = await db.select().from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.entityType, "bora_master"),
        sql`${importBatchesTable.undoneAt} IS NULL`,
      ))
      .orderBy(desc(importBatchesTable.createdAt))
      .limit(1);

    if (!lastBatch) {
      res.status(404).json({ error: "No import to undo" }); return;
    }

    const deleted = await db.delete(productBundleMasterTable)
      .where(eq(productBundleMasterTable.importBatchId, lastBatch.id))
      .returning();

    await db.update(importBatchesTable).set({ undoneAt: new Date(), undoneBy: user.id })
      .where(eq(importBatchesTable.id, lastBatch.id));

    await logAudit("import_batch", lastBatch.id, "undo", null, { deletedCount: deleted.length }, user.id);

    res.json({ undone: deleted.length, batchId: lastBatch.id });
  } catch (err) {
    console.error("Bora import undo error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
// TRANSPORT CALCULATION (existing, updated to use new fields)
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/calculate", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { items, destinationState, destinationCity, destinationPinCode, productionUnit } = req.body;
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ error: "items array is required" }); return;
    }

    // PIN-first destination lookup
    let dest: any = null;
    const activeOnly = eq(transportDestinationMasterTable.isActive, true);

    if (destinationPinCode) {
      const [pinDest] = await db.select().from(transportDestinationMasterTable)
        .where(and(activeOnly, eq(transportDestinationMasterTable.pinCode, destinationPinCode),
          productionUnit ? or(eq(transportDestinationMasterTable.productionUnit, productionUnit), isNull(transportDestinationMasterTable.productionUnit)) : undefined))
        .orderBy(transportDestinationMasterTable.transportCharge).limit(1);
      dest = pinDest;
    }
    if (!dest && destinationCity && destinationState) {
      const [cityDest] = await db.select().from(transportDestinationMasterTable)
        .where(and(activeOnly, ilike(transportDestinationMasterTable.city, destinationCity),
          ilike(transportDestinationMasterTable.state, destinationState),
          productionUnit ? or(eq(transportDestinationMasterTable.productionUnit, productionUnit), isNull(transportDestinationMasterTable.productionUnit)) : undefined))
        .orderBy(transportDestinationMasterTable.transportCharge).limit(1);
      dest = cityDest;
    }

    if (!dest) {
      res.json({ found: false, error: "Destination not found in master" }); return;
    }

    const results = [];
    let totalTransportCost = 0;

    for (const item of items) {
      const productName = item.productName;
      const quantity = Number(item.quantity || 0);

      // Find bundle: prefer unit-specific, fallback to shared
      let bundle: any = null;
      if (productionUnit) {
        const [unitBundle] = await db.select().from(productBundleMasterTable)
          .where(and(ilike(productBundleMasterTable.productName, productName),
            eq(productBundleMasterTable.isActive, true),
            eq(productBundleMasterTable.productionUnit, productionUnit))).limit(1);
        bundle = unitBundle;
      }
      if (!bundle) {
        const [sharedBundle] = await db.select().from(productBundleMasterTable)
          .where(and(ilike(productBundleMasterTable.productName, productName),
            eq(productBundleMasterTable.isActive, true),
            isNull(productBundleMasterTable.productionUnit))).limit(1);
        bundle = sharedBundle;
      }

      const bundleSize = bundle?.bundleSize || 0;
      const numBundles = bundleSize > 0 ? Math.ceil(quantity / bundleSize) : 0;
      const transportCostPerBundle = Number(dest.transportCharge || 0);
      const itemTransportCost = numBundles * transportCostPerBundle;

      totalTransportCost += itemTransportCost;

      results.push({
        productName,
        quantity,
        bundleSize,
        linerPackingQty: bundle?.linerPackingQty || 0,
        tciBoraQty: bundle?.tciBoraQty || 0,
        normalBoraQty: bundle?.normalBoraQty || 0,
        numBundles,
        transportType: dest.transportType,
        transportCostPerBundle,
        itemTransportCost,
      });
    }

    res.json({
      found: true,
      destination: {
        id: dest.id,
        state: dest.state,
        city: dest.city,
        pinCode: dest.pinCode,
        transportCompany: dest.transportCompany,
        transportType: dest.transportType,
        transitDays: dest.transitDays,
        productionUnit: dest.productionUnit,
      },
      items: results,
      totalTransportCost,
    });
  } catch (err) {
    console.error("Transport calculation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
