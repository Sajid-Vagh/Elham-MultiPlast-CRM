import { Router, type IRouter } from "express";
import { db, productBundleMasterTable, transportDestinationMasterTable } from "@workspace/db";
import { eq, and, sql, ilike, or, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

// Helper: get visible production units for the user
function getVisibleUnits(user: { role: string; productionUnit?: string | null }): string[] | null {
  if (user.role === "admin" || user.role === "support") return null; // null = no filter, see all
  if (user.productionUnit === "Himatnagar") return null; // Himatnagar sees all
  if (user.productionUnit === "Surat" || user.productionUnit === "Rajkot") return [user.productionUnit];
  return []; // unknown unit = see nothing
}

// Helper: build unit filter condition
function unitFilter(userUnit: string | null | undefined) {
  // admin/support/Himatnagar see all (no filter)
  if (!userUnit || userUnit === "Himatnagar" || userUnit === "admin" || userUnit === "support") return undefined;
  // Surat/Rajkot see only their own + shared (NULL = "All Units")
  return or(
    eq(productBundleMasterTable.productionUnit, userUnit),
    isNull(productBundleMasterTable.productionUnit),
  );
}

function unitFilterDest(userUnit: string | null | undefined) {
  if (!userUnit || userUnit === "Himatnagar" || userUnit === "admin" || userUnit === "support") return undefined;
  return or(
    eq(transportDestinationMasterTable.productionUnit, userUnit),
    isNull(transportDestinationMasterTable.productionUnit),
  );
}

// ── Product Bundle Master CRUD ──

// List all product bundles
router.get("/transport-masters/bundles", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, page = "1", limit = "50", unit } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (search) {
      conditions.push(ilike(productBundleMasterTable.productName, `%${search}%`));
    }

    // Unit-based RBAC filtering
    const visibleUnits = getVisibleUnits(user);
    if (visibleUnits !== null) {
      if (unit) {
        // Explicit unit filter from frontend
        if (visibleUnits.includes(unit)) {
          conditions.push(
            or(
              eq(productBundleMasterTable.productionUnit, unit),
              isNull(productBundleMasterTable.productionUnit),
            )
          );
        }
        // If unit not in visibleUnits, conditions remain empty (see nothing beyond shared)
      } else if (visibleUnits.length === 0) {
        // No visible units = only shared (NULL)
        conditions.push(isNull(productBundleMasterTable.productionUnit));
      }
      // If visibleUnits has values but no explicit unit param: see shared + own unit
      // This is the default "My Unit + Shared" view
    }

    const where = conditions.length ? and(...conditions) : undefined;
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
    console.error("List product bundles error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get bundle size for a product (used by transport calculation)
router.get("/transport-masters/bundles/lookup", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { productName, productionUnit } = req.query as Record<string, string>;
    if (!productName) {
      res.status(400).json({ error: "productName is required" });
      return;
    }

    const conditions: any[] = [
      ilike(productBundleMasterTable.productName, productName),
      eq(productBundleMasterTable.isActive, true),
    ];

    // If a production unit is specified, prefer that unit's bundle; fallback to shared
    if (productionUnit) {
      const [bundle] = await db
        .select()
        .from(productBundleMasterTable)
        .where(and(
          ilike(productBundleMasterTable.productName, productName),
          eq(productBundleMasterTable.isActive, true),
          eq(productBundleMasterTable.productionUnit, productionUnit),
        ))
        .limit(1);

      if (bundle) { res.json(bundle); return; }
    }

    // Fallback to shared (NULL productionUnit)
    const [bundle] = await db
      .select()
      .from(productBundleMasterTable)
      .where(and(
        ilike(productBundleMasterTable.productName, productName),
        eq(productBundleMasterTable.isActive, true),
        isNull(productBundleMasterTable.productionUnit),
      ))
      .limit(1);

    res.json(bundle || null);
  } catch (err) {
    console.error("Bundle lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create product bundle (admin/support only)
router.post("/transport-masters/bundles", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { productName, productId, bundleSize, productionUnit } = req.body;
    if (!productName || !bundleSize) {
      res.status(400).json({ error: "Product name and bundle size are required" }); return;
    }

    const [created] = await db.insert(productBundleMasterTable).values({
      productName: productName.trim(),
      productId: productId || null,
      bundleSize: Number(bundleSize),
      productionUnit: productionUnit || null,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create product bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update product bundle (admin/support only)
router.patch("/transport-masters/bundles/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { updatedAt: new Date() };
    if (req.body.productName !== undefined) updateData.productName = req.body.productName.trim();
    if (req.body.bundleSize !== undefined) updateData.bundleSize = Number(req.body.bundleSize);
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
    if (req.body.productionUnit !== undefined) updateData.productionUnit = req.body.productionUnit || null;

    const [updated] = await db.update(productBundleMasterTable).set(updateData).where(eq(productBundleMasterTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    console.error("Update product bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete product bundle (admin/support only)
router.delete("/transport-masters/bundles/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(productBundleMasterTable).where(eq(productBundleMasterTable.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Delete product bundle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Transport Destination Master CRUD ──

// List all destinations
router.get("/transport-masters/destinations", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, state, city, page = "1", limit = "50", unit } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (state) conditions.push(ilike(transportDestinationMasterTable.state, `%${state}%`));
    if (city) conditions.push(ilike(transportDestinationMasterTable.city, `%${city}%`));
    if (search) {
      conditions.push(
        or(
          ilike(transportDestinationMasterTable.state, `%${search}%`),
          ilike(transportDestinationMasterTable.city, `%${search}%`),
        )
      );
    }

    // Unit-based RBAC filtering
    const visibleUnits = getVisibleUnits(user);
    if (visibleUnits !== null) {
      if (unit) {
        if (visibleUnits.includes(unit)) {
          conditions.push(
            or(
              eq(transportDestinationMasterTable.productionUnit, unit),
              isNull(transportDestinationMasterTable.productionUnit),
            )
          );
        }
      } else if (visibleUnits.length === 0) {
        conditions.push(isNull(transportDestinationMasterTable.productionUnit));
      }
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(transportDestinationMasterTable).where(where);
    const data = await db.select().from(transportDestinationMasterTable)
      .where(where)
      .orderBy(transportDestinationMasterTable.state, transportDestinationMasterTable.city)
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

// Get transport charge for a destination
router.get("/transport-masters/destinations/lookup", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { state, city, productionUnit } = req.query as Record<string, string>;
    if (!state || !city) {
      res.status(400).json({ error: "state and city are required" }); return;
    }

    // If a production unit is specified, prefer that unit's rate; fallback to shared
    if (productionUnit) {
      const [dest] = await db
        .select()
        .from(transportDestinationMasterTable)
        .where(and(
          ilike(transportDestinationMasterTable.state, state),
          ilike(transportDestinationMasterTable.city, city),
          eq(transportDestinationMasterTable.isActive, true),
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
        ))
        .limit(1);

      if (dest) { res.json(dest); return; }
    }

    // Fallback to shared (NULL productionUnit)
    const [dest] = await db
      .select()
      .from(transportDestinationMasterTable)
      .where(and(
        ilike(transportDestinationMasterTable.state, state),
        ilike(transportDestinationMasterTable.city, city),
        eq(transportDestinationMasterTable.isActive, true),
        isNull(transportDestinationMasterTable.productionUnit),
      ))
      .limit(1);

    res.json(dest || null);
  } catch (err) {
    console.error("Destination lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create destination (admin/support only)
router.post("/transport-masters/destinations", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { state, city, transportType, transportCharge, productionUnit } = req.body;
    if (!state || !city || !transportType) {
      res.status(400).json({ error: "State, city, and transport type are required" }); return;
    }

    const [created] = await db.insert(transportDestinationMasterTable).values({
      state: state.trim(),
      city: city.trim(),
      transportType: transportType.trim(),
      transportCharge: String(transportCharge || 0),
      productionUnit: productionUnit || null,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update destination (admin/support only)
router.patch("/transport-masters/destinations/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { updatedAt: new Date() };
    if (req.body.state !== undefined) updateData.state = req.body.state.trim();
    if (req.body.city !== undefined) updateData.city = req.body.city.trim();
    if (req.body.transportType !== undefined) updateData.transportType = req.body.transportType.trim();
    if (req.body.transportCharge !== undefined) updateData.transportCharge = String(req.body.transportCharge);
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
    if (req.body.productionUnit !== undefined) updateData.productionUnit = req.body.productionUnit || null;

    const [updated] = await db.update(transportDestinationMasterTable).set(updateData).where(eq(transportDestinationMasterTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    console.error("Update destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete destination (admin/support only)
router.delete("/transport-masters/destinations/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(transportDestinationMasterTable).where(eq(transportDestinationMasterTable.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Delete destination error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Transport Calculation Endpoint ──
// Calculates total transport cost for an order based on products + destinations
// Accepts optional productionUnit to prefer unit-specific rates
router.post("/transport-masters/calculate", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { items, destinationState, destinationCity, productionUnit } = req.body;
    if (!items || !Array.isArray(items) || !destinationState || !destinationCity) {
      res.status(400).json({ error: "items array, destinationState, and destinationCity are required" }); return;
    }

    // Find destination: prefer unit-specific, fallback to shared
    let dest: any = null;
    if (productionUnit) {
      const [unitDest] = await db
        .select()
        .from(transportDestinationMasterTable)
        .where(and(
          ilike(transportDestinationMasterTable.state, destinationState),
          ilike(transportDestinationMasterTable.city, destinationCity),
          eq(transportDestinationMasterTable.isActive, true),
          eq(transportDestinationMasterTable.productionUnit, productionUnit),
        ))
        .limit(1);
      dest = unitDest;
    }

    if (!dest) {
      const [sharedDest] = await db
        .select()
        .from(transportDestinationMasterTable)
        .where(and(
          ilike(transportDestinationMasterTable.state, destinationState),
          ilike(transportDestinationMasterTable.city, destinationCity),
          eq(transportDestinationMasterTable.isActive, true),
          isNull(transportDestinationMasterTable.productionUnit),
        ))
        .limit(1);
      dest = sharedDest;
    }

    if (!dest) {
      res.json({ found: false, error: "Destination not found in master" });
      return;
    }

    const results = [];
    let totalTransportCost = 0;

    for (const item of items) {
      const productName = item.productName;
      const quantity = Number(item.quantity || 0);

      // Find bundle: prefer unit-specific, fallback to shared
      let bundle: any = null;
      if (productionUnit) {
        const [unitBundle] = await db
          .select()
          .from(productBundleMasterTable)
          .where(and(
            ilike(productBundleMasterTable.productName, productName),
            eq(productBundleMasterTable.isActive, true),
            eq(productBundleMasterTable.productionUnit, productionUnit),
          ))
          .limit(1);
        bundle = unitBundle;
      }

      if (!bundle) {
        const [sharedBundle] = await db
          .select()
          .from(productBundleMasterTable)
          .where(and(
            ilike(productBundleMasterTable.productName, productName),
            eq(productBundleMasterTable.isActive, true),
            isNull(productBundleMasterTable.productionUnit),
          ))
          .limit(1);
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
        numBundles,
        transportType: dest.transportType,
        transportCostPerBundle,
        itemTransportCost,
      });
    }

    res.json({
      found: true,
      destination: { state: dest.state, city: dest.city, transportType: dest.transportType, productionUnit: dest.productionUnit },
      items: results,
      totalTransportCost,
    });
  } catch (err) {
    console.error("Transport calculation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
