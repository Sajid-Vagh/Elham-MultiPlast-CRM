import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { db, usersTable } from "@workspace/db";
import { eq, inArray, or, sql } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody, GetUserParams, UpdateUserParams, DeleteUserParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { storage, normalizeProfilePhotoUrl, extractStoragePathFromProfilePhotoUrl } from "../lib/storage";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function uploadProfilePhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("photo")(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string })?.code;
      if (code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ success: false, error: "File too large (max 5MB)" });
        return;
      }
      req.log?.error({ err }, "Profile photo upload rejected");
      res.status(400).json({ success: false, error: "File upload failed" });
      return;
    }
    next();
  });
}

const router: IRouter = Router();

function safeUser(u: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...rest } = u;
  if (rest.profilePhoto) rest.profilePhoto = normalizeProfilePhotoUrl(rest.profilePhoto);
  return rest;
}

router.get("/users", async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const rolesParam = req.query.roles as string | undefined;
    let users;
    if (rolesParam) {
      const roles = rolesParam.split(",").map(r => r.trim()).filter(Boolean);
      users = roles.length > 0
        ? await db.select().from(usersTable).where(inArray(usersTable.role, roles)).orderBy(usersTable.name)
        : await db.select().from(usersTable).orderBy(usersTable.name);
    } else {
      users = await db.select().from(usersTable).orderBy(usersTable.name);
    }
    res.json(users.map(safeUser));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
  const { password, ...fields } = parsed.data;
  const permissions = (req.body as any).permissions ?? {};
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({ ...fields, passwordHash, isActive: true, emailVerified: false, permissions }).returning();

    // Notify all admins about new user creation
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      if (admin.id !== me.id) {
        await createNotification({
          createdById: me.id,
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/users/contact-owners", async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    // Customer-facing roles PLUS any user who currently owns at least one
    // contact/lead — regardless of their primary role. This keeps Production /
    // Support users that own leads selectable in the "All Owners" filters.
    const owners = await db
      .select()
      .from(usersTable)
      .where(or(
        inArray(usersTable.role, ["admin", "sales", "production", "production_and_support"]),
        sql`EXISTS (SELECT 1 FROM contacts c WHERE c.sales_owner_id = ${usersTable.id})`
      ))
      .orderBy(usersTable.name);
    res.json(owners.map(safeUser));
  } catch (err) {
    req.log.error({ err }, "List contact owners error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

  // Non-admin users may only update their profile photo.
  // Graceful handling: ignore restricted fields that arrive UNCHANGED (no-op), and only
  // reject when they actually try to change restricted fields to different values.
  if (!isAdmin) {
    const restrictedFields = ["name", "username", "role", "colorCode", "unit", "canViewAllReports", "canAssignLeads", "permissions"];
    const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!currentUser) { res.status(404).json({ error: "Not found" }); return; }
    const attemptedChanges: string[] = [];
    for (const key of restrictedFields) {
      if ((fields as Record<string, unknown>)[key] !== undefined) {
        if ((fields as Record<string, unknown>)[key] === (currentUser as Record<string, unknown>)[key]) {
          // Unchanged field — strip it and continue with profilePhoto
          delete (fields as Record<string, unknown>)[key];
        } else {
          attemptedChanges.push(key);
        }
      }
    }
    if (attemptedChanges.length > 0 || password) {
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
  if ((fields as any).canViewAllReports !== undefined) updateData.canViewAllReports = (fields as any).canViewAllReports;
  if ((fields as any).canAssignLeads !== undefined) updateData.canAssignLeads = (fields as any).canAssignLeads;
  if ((req.body as any).permissions !== undefined) updateData.permissions = (req.body as any).permissions;
  if ((fields as any).profilePhoto !== undefined) updateData.profilePhoto = (fields as any).profilePhoto;
  if (password && isAdmin) {
    updateData.passwordHash = await bcrypt.hash(password, 10);
  }
  try {
    const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id)).returning();
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(safeUser(user));
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

const ALLOWED_PHOTO_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

// Upload profile photo — admin can upload for any user, sales can upload own
router.post("/users/:id/photo", uploadProfilePhoto, async (req, res) => {
  try {
    const me = await getUserFromRequest(req);
    if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
    const userId = Number(req.params.id);
    if (me.role !== "admin" && me.id !== userId) {
      res.status(403).json({ error: "You can only upload your own profile photo" });
      return;
    }
    if (!req.file) { res.status(400).json({ success: false, error: "No file uploaded" }); return; }
    if (!(req.file.mimetype in ALLOWED_PHOTO_MIMES)) {
      res.status(400).json({ success: false, error: "Only JPG, PNG, and GIF images are allowed" });
      return;
    }

    // Fetch the current user to locate (and later delete) the old file
    const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

    const storagePath = await storage.save(req.file.originalname || "photo.png", req.file.buffer, "profile-photos");
    const photoUrl = normalizeProfilePhotoUrl(storage.getUrl(storagePath));
    const [user] = await db.update(usersTable).set({ profilePhoto: photoUrl }).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Best-effort cleanup of the previous photo file (ignore errors)
    if (currentUser?.profilePhoto) {
      const oldPath = extractStoragePathFromProfilePhotoUrl(currentUser.profilePhoto);
      if (oldPath && oldPath !== storagePath) {
        storage.delete(oldPath).catch(() => {});
      }
    }

    res.json({ profilePhoto: photoUrl, user: safeUser(user) });
  } catch (err) {
    req.log.error({ err }, "Failed to upload profile photo");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    // Fetch current photo URL before clearing so we can delete the file
    const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const [user] = await db.update(usersTable).set({ profilePhoto: null }).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Best-effort deletion of the file from storage (ignore errors)
    if (currentUser?.profilePhoto) {
      const storagePath = extractStoragePathFromProfilePhotoUrl(currentUser.profilePhoto);
      if (storagePath) {
        storage.delete(storagePath).catch(() => {});
      }
    }

    res.json(safeUser(user));
  } catch (err) {
    req.log.error({ err }, "Delete profile photo error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    // Fetch the target user first — admin accounts are protected and can never be deleted.
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!target) { res.status(404).json({ error: "Not found" }); return; }
    if (target.role === "admin") {
      res.status(403).json({ error: "Admin users cannot be deleted" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete user error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
