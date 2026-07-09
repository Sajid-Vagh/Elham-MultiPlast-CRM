import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "node:path";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody, GetUserParams, UpdateUserParams, DeleteUserParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { storage } from "../lib/storage";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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

    // Notify all admins about new user creation
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      if (admin.id !== me.id) {
        await createNotification({
          userId: admin.id,
          type: "user_created",
          title: "New User Created",
          message: `New user "${user!.name}" (${user!.role}) has been created.\nCreated By: ${me.name}`,
          link: `/settings`,
          relatedId: user!.id,
          relatedType: "user",
        });
      }
    }

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
  if (!me || (me.role !== "admin" && me.id !== Number(req.params.id))) {
    res.status(403).json({ error: "Admin only or own profile only" });
    return;
  }
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { password, ...fields } = parsed.data;
  const isAdmin = me.role === "admin";

  // Non-admin users may only update profilePhoto
  if (!isAdmin) {
    const restrictedFields = ["name", "username", "role", "colorCode", "unit", "canViewAllReports", "canAssignLeads"];
    const attempted = Object.keys(fields).filter(k => restrictedFields.includes(k));
    if (attempted.length > 0 || password) {
      res.status(403).json({ error: "Sales users may only update their profile photo" });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (fields.name !== undefined) updateData.name = fields.name;
  if (fields.username !== undefined) updateData.username = fields.username;
  if (fields.role !== undefined) updateData.role = fields.role;
  if (fields.colorCode !== undefined) updateData.colorCode = fields.colorCode;
  if (fields.unit !== undefined) updateData.unit = fields.unit;
  if (fields.canViewAllReports !== undefined) updateData.canViewAllReports = fields.canViewAllReports;
  if (fields.canAssignLeads !== undefined) updateData.canAssignLeads = fields.canAssignLeads;
  if (fields.profilePhoto !== undefined) updateData.profilePhoto = fields.profilePhoto;
  if (password && isAdmin) {
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

// Upload profile photo — admin can upload for any user, sales can upload own
router.post("/users/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const userId = Number(req.params.id);
    if (me.role !== "admin" && me.id !== userId) {
      res.status(403).json({ error: "You can only upload your own profile photo" });
      return;
    }
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }
    if (!file.mimetype.startsWith("image/")) {
      res.status(400).json({ error: "Only image files are allowed" });
      return;
    }
    const storagePath = await storage.save(`profile-${userId}${path.extname(file.originalname)}`, file.buffer, "profiles");
    const photoUrl = storage.getUrl(storagePath);
    const [user] = await db.update(usersTable).set({ profilePhoto: photoUrl }).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ profilePhoto: photoUrl, user: safeUser(user) });
  } catch (err) {
    req.log.error({ err }, "Upload profile photo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete profile photo
router.delete("/users/:id/photo", async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const userId = Number(req.params.id);
    if (me.role !== "admin" && me.id !== userId) {
      res.status(403).json({ error: "You can only remove your own profile photo" });
      return;
    }
    const [user] = await db.update(usersTable).set({ profilePhoto: null }).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(safeUser(user));
  } catch (err) {
    req.log.error({ err }, "Delete profile photo error");
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
