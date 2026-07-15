import { Router, type IRouter } from "express";
import { db, unitsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

router.get("/units", async (req, res) => {
  try {
    const showAll = req.query.all === "true";
    const where = showAll ? undefined : eq(unitsTable.isActive, true);
    const units = await db.select().from(unitsTable).where(where).orderBy(asc(unitsTable.name));
    res.json(units);
  } catch (err) {
    req.log.error({ err }, "List units error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/units", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Unit name is required" });
    return;
  }
  const trimmed = name.trim();
  const id = `unit-${trimmed.toLowerCase().replace(/\s+/g, "-")}`;
  try {
    const existing = await db.select().from(unitsTable).where(eq(unitsTable.name, trimmed)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Unit already exists" });
      return;
    }
    const [unit] = await db.insert(unitsTable).values({ id, name: trimmed }).returning();
    res.status(201).json(unit);
  } catch (err) {
    req.log.error({ err }, "Create unit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/units/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const { id } = req.params;
  const { name, isActive } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Unit name cannot be empty" });
      return;
    }
    updates.name = name.trim();
  }
  if (isActive !== undefined) {
    updates.isActive = !!isActive;
  }
  try {
    const [unit] = await db.update(unitsTable).set(updates).where(eq(unitsTable.id, id)).returning();
    if (!unit) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json(unit);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Unit name already exists" });
      return;
    }
    req.log.error({ err }, "Update unit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/units/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const { id } = req.params;
  try {
    const [unit] = await db.delete(unitsTable).where(eq(unitsTable.id, id)).returning();
    if (!unit) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete unit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
