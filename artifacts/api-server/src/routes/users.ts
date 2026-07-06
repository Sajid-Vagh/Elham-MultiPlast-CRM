import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody, GetUserParams, UpdateUserParams, DeleteUserParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

function safeUser(u: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...rest } = u;
  return rest;
}

router.get("/users", async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const users = await db.select().from(usersTable).orderBy(usersTable.name);
    res.json(users.map(safeUser));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = parsed.error.flatten();
    const details = { fieldErrors, formErrors };
    res.status(400).json({ error: "Invalid input", details });
    return;
  }
  const { password, ...rest } = parsed.data;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({ ...rest, passwordHash }).returning();
    res.status(201).json(safeUser(user!));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    req.log.error({ err }, "Create user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = GetUserParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.id));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(safeUser(user));
  } catch (err) {
    req.log.error({ err }, "Get user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { password, ...fields } = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (fields.name !== undefined) updateData.name = fields.name;
  if (fields.username !== undefined) updateData.username = fields.username;
  if (fields.role !== undefined) updateData.role = fields.role;
  if (fields.colorCode !== undefined) updateData.colorCode = fields.colorCode;
  if (fields.unit !== undefined) updateData.unit = fields.unit;
  if (fields.canViewAllReports !== undefined) updateData.canViewAllReports = fields.canViewAllReports;
  if (fields.canAssignLeads !== undefined) updateData.canAssignLeads = fields.canAssignLeads;
  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, 10);
  }
  try {
    const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id)).returning();
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(safeUser(user));
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/users/:id", async (req, res) => {
  const me = await getUserFromRequest(req);
  if (!me || me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const params = DeleteUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
