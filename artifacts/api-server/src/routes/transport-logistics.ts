import { Router, type IRouter } from "express";
import { db, transportLogisticsTable } from "@workspace/db";
import { eq, and, sql, ilike, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

// List transport logistics entries (searchable by state, city, product)
router.get("/transport-logistics", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search, state, city, product, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (state) conditions.push(ilike(transportLogisticsTable.destinationState, `%${state}%`));
    if (city) conditions.push(ilike(transportLogisticsTable.destinationCity, `%${city}%`));
    if (product) conditions.push(ilike(transportLogisticsTable.productName, `%${product}%`));
    if (search) {
      conditions.push(
        or(
          ilike(transportLogisticsTable.productName, `%${search}%`),
          ilike(transportLogisticsTable.destinationState, `%${search}%`),
          ilike(transportLogisticsTable.destinationCity, `%${search}%`),
        )
      );
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(transportLogisticsTable).where(where);
    const data = await db.select().from(transportLogisticsTable)
      .where(where)
      .orderBy(transportLogisticsTable.productName, transportLogisticsTable.destinationState)
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
    console.error("List transport logistics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create transport logistics entry (support/admin only)
router.post("/transport-logistics", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { productName, destinationState, destinationCity, bundleSizeQty, transportCostPerBundle } = req.body;

    if (!productName || !destinationState || !destinationCity || !bundleSizeQty || transportCostPerBundle === undefined) {
      res.status(400).json({ error: "All fields are required" }); return;
    }

    const [created] = await db.insert(transportLogisticsTable).values({
      productName: productName.trim(),
      destinationState: destinationState.trim(),
      destinationCity: destinationCity.trim(),
      bundleSizeQty: Number(bundleSizeQty),
      transportCostPerBundle: String(transportCostPerBundle),
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("Create transport logistics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update transport logistics entry (support/admin only)
router.patch("/transport-logistics/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportLogisticsTable).where(eq(transportLogisticsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { updatedAt: new Date() };
    if (req.body.productName !== undefined) updateData.productName = req.body.productName.trim();
    if (req.body.destinationState !== undefined) updateData.destinationState = req.body.destinationState.trim();
    if (req.body.destinationCity !== undefined) updateData.destinationCity = req.body.destinationCity.trim();
    if (req.body.bundleSizeQty !== undefined) updateData.bundleSizeQty = Number(req.body.bundleSizeQty);
    if (req.body.transportCostPerBundle !== undefined) updateData.transportCostPerBundle = String(req.body.transportCostPerBundle);

    const [updated] = await db.update(transportLogisticsTable).set(updateData).where(eq(transportLogisticsTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    console.error("Update transport logistics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete transport logistics entry (support/admin only)
router.delete("/transport-logistics/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin" && user.role !== "support") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(transportLogisticsTable).where(eq(transportLogisticsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(transportLogisticsTable).where(eq(transportLogisticsTable.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Delete transport logistics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
