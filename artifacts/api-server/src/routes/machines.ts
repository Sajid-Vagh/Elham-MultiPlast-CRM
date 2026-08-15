import { Router, type IRouter } from "express";
import { db, machinesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

router.get("/machines", async (req, res) => {
  try {
    const showAll = req.query.all === "true";
    const where = showAll ? undefined : eq(machinesTable.isActive, true);
    const machines = await db.select().from(machinesTable).where(where).orderBy(asc(machinesTable.name));
    res.json(machines);
  } catch (err) {
    req.log.error({ err }, "List machines error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/machines", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Machine name is required" });
    return;
  }
  const trimmed = name.trim();
  const id = `machine-${trimmed.toLowerCase().replace(/\s+/g, "-")}`;
  try {
    const existing = await db.select().from(machinesTable).where(eq(machinesTable.name, trimmed)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Machine already exists" });
      return;
    }
    const [machine] = await db.insert(machinesTable).values({ id, name: trimmed }).returning();
    res.status(201).json(machine);
  } catch (err) {
    req.log.error({ err }, "Create machine error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.patch("/machines/:id", async (req, res) => {
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
      res.status(400).json({ error: "Machine name cannot be empty" });
      return;
    }
    updates.name = name.trim();
  }
  if (isActive !== undefined) {
    updates.isActive = !!isActive;
  }
  try {
    const [machine] = await db.update(machinesTable).set(updates).where(eq(machinesTable.id, id)).returning();
    if (!machine) {
      res.status(404).json({ error: "Machine not found" });
      return;
    }
    res.json(machine);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Machine name already exists" });
      return;
    }
    req.log.error({ err }, "Update machine error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.delete("/machines/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const { id } = req.params;
  try {
    const [machine] = await db.delete(machinesTable).where(eq(machinesTable.id, id)).returning();
    if (!machine) {
      res.status(404).json({ error: "Machine not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete machine error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
