import { Router, type IRouter } from "express";
import { db, productBundleMasterTable, transportDestinationMasterTable, importBatchesTable, auditLogsTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, and, sql, ilike, or, isNull, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { requireAuth } from "../middlewares/auth";
import { canManageTransportLookup, canImportTransportLookup, canUndoImport, canDeleteTransportLookup, canEditTransportLookup, type PermissionUser } from "../lib/permission-service";

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create destination (admin/support/production only)
router.post("/transport-masters/destinations", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { state, city, pinCode, transportCompany, transportType, transportCharge, transitDays, tciBora, normalBora, productionUnit, remarks } = req.body;
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
      tciBora: tciBora !== undefined && tciBora !== "" ? String(tciBora) : "0",
      normalBora: normalBora !== undefined && normalBora !== "" ? String(normalBora) : "0",
      transitDays: transitDays ? Number(transitDays) : null,
      productionUnit: productionUnit && productionUnit !== "all" ? productionUnit : null,
      remarks: remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create destination error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update destination (admin/support only) with audit
router.patch("/transport-masters/destinations/:id", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canEditTransportLookup(user)) { res.status(403).json({ error: "Admin or Support only" }); return; }

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Whitelist: only body fields that map to table columns are used by Drizzle's
    // buildUpdateSet (unknown keys are ignored). Strip columns that must never change.
    const { id: _bodyId, createdAt: _bodyCreatedAt, createdBy: _bodyCreatedBy, importBatchId: _bodyImportBatchId, ...body } = req.body;
    const updateData: any = { ...body, updatedAt: new Date(), updatedBy: user.id };

    const [updated] = await db.update(transportDestinationMasterTable).set(updateData).where(eq(transportDestinationMasterTable.id, id)).returning();

    // Audit trail
    await logAudit("transport_master", id, "update", existing, updated, user.id);

    res.json(updated);
  } catch (err) {
    console.error("Update destination error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete destination (admin/support only)
router.delete("/transport-masters/destinations/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canDeleteTransportLookup(user)) { res.status(403).json({ error: "Admin or Support only" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    await logAudit("transport_master", id, "delete", existing, null, user.id);
    res.status(204).send();
  } catch (err) {
    console.error("Delete destination error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

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
      for (const [rateField, label] of [["tciBora", "TCI Bora"], ["normalBora", "Normal Bora"]] as const) {
        if (row[rateField] !== undefined && row[rateField] !== "" && isNaN(Number(row[rateField]))) {
          errors.push({ row: rowNum, field: rateField, message: `Invalid ${label} rate` }); rowValid = false;
        } else if (row[rateField] !== undefined && row[rateField] !== "" && Number(row[rateField]) < 0) {
          errors.push({ row: rowNum, field: rateField, message: `${label} rate cannot be negative` }); rowValid = false;
        }
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Execute import: insert valid rows
// Shared by the legacy execute route (unit optional) and the `/transport-rates/upload`
// alias (unit mandatory — every imported row is stamped with the selected unit).
function makeDestinationsImportExecute(requireUnit: boolean) {
  return async (req: any, res: any) => {
    try {
      const user = await authUser(req);
      if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
      if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

      const { rows, fileName, productionUnit: forcedUnit } = req.body as { rows: any[]; fileName?: string; productionUnit?: string };
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "rows array is required" }); return;
      }
      const tagUnit = forcedUnit && forcedUnit !== "all" ? String(forcedUnit).trim() : null;
      if (requireUnit && !tagUnit) {
        res.status(400).json({ error: "Unit selection is required — every imported row must be tagged with a production unit" }); return;
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
            tciBora: row.tciBora !== undefined && row.tciBora !== "" ? String(row.tciBora) : "0",
            normalBora: row.normalBora !== undefined && row.normalBora !== "" ? String(row.normalBora) : "0",
            transitDays: row.transitDays ? Number(row.transitDays) : null,
            productionUnit: tagUnit ?? (row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null),
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
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  };
}

router.post("/transport-masters/destinations/import/execute", makeDestinationsImportExecute(false));
router.post("/transport-rates/upload", makeDestinationsImportExecute(true));

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    const { search, page = "1", limit = "50", unit, strict } = req.query as Record<string, string>;
    const conditions: any[] = [eq(productBundleMasterTable.isActive, true)];

    if (search) {
      conditions.push(ilike(productBundleMasterTable.productName, `%${search}%`));
    }

    if (unit && unit !== "all") {
      // strict=true → return ONLY records tagged to this unit (no shared/All fallback).
      if (strict === "true") {
        conditions.push(eq(productBundleMasterTable.productionUnit, unit));
      } else {
        conditions.push(or(
          eq(productBundleMasterTable.productionUnit, unit),
          isNull(productBundleMasterTable.productionUnit),
        ));
      }
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
      data: data.map((b) => ({ ...b, linerPacking: b.linerPackingQty })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.count ?? 0,
        totalPages: Math.ceil((countResult?.count ?? 0) / limitNum),
      },
    });
  } catch (err) {
    console.error("List bundles error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create bundle (admin/support/production only)
router.post("/transport-masters/bundles", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canManageTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { productName, productId, bundleSize, linerPackingQty, bora, productionUnit, remarks } = req.body;
    if (!productName) {
      res.status(400).json({ error: "Product name is required" }); return;
    }

    const [created] = await db.insert(productBundleMasterTable).values({
      productName: productName.trim(),
      productId: productId || null,
      bundleSize: Number(bundleSize || 80),
      linerPackingQty: Number(linerPackingQty || 0),
      bora: Number(bora || 0),
      productionUnit: productionUnit && productionUnit !== "all" ? productionUnit : null,
      remarks: remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create bundle error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update bundle (admin/support only) with audit
router.patch("/transport-masters/bundles/:id", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canEditTransportLookup(user)) { res.status(403).json({ error: "Admin or Support only" }); return; }

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Whitelist: only body fields that map to table columns are used by Drizzle's
    // buildUpdateSet (unknown keys are ignored). Strip columns that must never change.
    const { id: _bodyId, createdAt: _bodyCreatedAt, createdBy: _bodyCreatedBy, importBatchId: _bodyImportBatchId, ...body } = req.body;
    const updateData: any = { ...body, updatedAt: new Date(), updatedBy: user.id };

    const [updated] = await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, id)).returning();

    await logAudit("packing_master", id, "update", existing, updated, user.id);

    res.json(updated);
  } catch (err) {
    console.error("Update bundle error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete bundle (admin/support only)
router.delete("/transport-masters/bundles/:id", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canDeleteTransportLookup(user)) { res.status(403).json({ error: "Admin or Support only" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    await logAudit("packing_master", id, "delete", existing, null, user.id);
    res.status(204).send();
  } catch (err) {
    console.error("Delete bundle error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ══════════════════════════════════════════════════════════════
// PACKING MASTER IMPORT
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

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
      if (row.bora !== undefined && row.bora !== "" && isNaN(Number(row.bora))) {
        errors.push({ row: rowNum, field: "bora", message: "Invalid quantity" }); rowValid = false;
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/transport-masters/bundles/import/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName, productionUnit: forcedUnit } = req.body as { rows: any[]; fileName?: string; productionUnit?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    const tagUnit = forcedUnit && forcedUnit !== "all" ? String(forcedUnit).trim() : null;

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
          bora: Number(row.bora || 0),
          productionUnit: tagUnit ?? (row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null),
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ══════════════════════════════════════════════════════════════
// LINER PACKING IMPORT (upsert: update linerPackingQty only)
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/liner/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/transport-masters/bundles/import/liner/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName, productionUnit: forcedUnit } = req.body as { rows: any[]; fileName?: string; productionUnit?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    const tagUnit = forcedUnit && forcedUnit !== "all" ? String(forcedUnit).trim() : null;

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
        const productionUnit = tagUnit ?? (row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null);
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
            bora: 0,
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ══════════════════════════════════════════════════════════════
// BORA PACKING IMPORT (upsert: update bora only)
// ══════════════════════════════════════════════════════════════

router.post("/transport-masters/bundles/import/bora/preview", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

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
      const hasBora = row.bora !== undefined && row.bora !== "" && !isNaN(Number(row.bora));
      if (!hasBora) {
        errors.push({ row: rowNum, field: "bora", message: "Bora quantity is required" }); rowValid = false;
      }
      if (hasBora && isNaN(Number(row.bora))) {
        errors.push({ row: rowNum, field: "bora", message: "Invalid Bora quantity" }); rowValid = false;
      }
      if (row.linerPackingQty !== undefined && row.linerPackingQty !== "" && isNaN(Number(row.linerPackingQty))) {
        errors.push({ row: rowNum, field: "linerPackingQty", message: "Invalid Liner Packing quantity" }); rowValid = false;
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/transport-masters/bundles/import/bora/execute", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canImportTransportLookup(user)) { res.status(403).json({ error: "Forbidden" }); return; }

    const { rows, fileName, productionUnit: forcedUnit } = req.body as { rows: any[]; fileName?: string; productionUnit?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required" }); return;
    }
    const tagUnit = forcedUnit && forcedUnit !== "all" ? String(forcedUnit).trim() : null;

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
        const productionUnit = tagUnit ?? (row.productionUnit && row.productionUnit !== "all" ? row.productionUnit.trim() : null);
        const bora = row.bora !== undefined && row.bora !== "" ? Number(row.bora) : 0;
        const bundleSize = row.bundleSize ? Number(row.bundleSize) : undefined;
        const linerPackingQty = row.linerPackingQty !== undefined && row.linerPackingQty !== "" ? Number(row.linerPackingQty) : 0;

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
          const updateData: any = { bora, updatedAt: new Date(), updatedBy: user.id, importBatchId: batch.id };
          if (bundleSize !== undefined) updateData.bundle_size = bundleSize;
          if (!isNaN(linerPackingQty) && linerPackingQty > 0) updateData.liner_packing_qty = linerPackingQty;
          await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, existing.id));
        } else {
          await db.insert(productBundleMasterTable).values({
            productName,
            bundleSize: bundleSize ?? 80,
            linerPackingQty: isNaN(linerPackingQty) ? 0 : linerPackingQty,
            bora,
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
        bora: bundle?.bora || 0,
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete all freight & packing lookup records (admin/support only)
router.delete("/transport-masters/clear-all", async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!canDeleteTransportLookup(user)) { res.status(403).json({ error: "Admin or Support only" }); return; }

    const deletedDestinations = await db.delete(transportDestinationMasterTable).returning({ id: transportDestinationMasterTable.id });
    const deletedBundles = await db.delete(productBundleMasterTable).returning({ id: productBundleMasterTable.id });

    const destinationsDeleted = deletedDestinations?.length ?? 0;
    const bundlesDeleted = deletedBundles?.length ?? 0;

    await logAudit("transport_master", 0, "clear_all", null, { destinations: destinationsDeleted, bundles: bundlesDeleted }, user.id);
    await logAudit("packing_master", 0, "clear_all", null, { destinations: destinationsDeleted, bundles: bundlesDeleted }, user.id);

    res.json({ success: true, deleted: { destinations: destinationsDeleted, bundles: bundlesDeleted } });
  } catch (err) {
    console.error("Clear all error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
