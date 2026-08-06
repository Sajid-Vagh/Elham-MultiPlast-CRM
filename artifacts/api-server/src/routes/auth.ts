import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { normalizeProfilePhotoUrl } from "../lib/storage";

const router: IRouter = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Strip the password hash and ALWAYS normalize the stored profile photo URL to
// its permanent public form before sending the user to the frontend. Both
// /auth/login and /auth/me must run this so the photo returned on every page
// load / login is byte-for-byte identical to the URL persisted at upload time
// (see POST /users/:id/photo). The full Drizzle row is selected (including the
// profile_photo column) so it can never be dropped before res.json().
function serializeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...safeUser } = user;
  if (safeUser.profilePhoto) safeUser.profilePhoto = normalizeProfilePhotoUrl(safeUser.profilePhoto);
  return safeUser;
}

export async function getUserIdFromToken(token: string): Promise<number | null> {
  try {
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token));
    return session?.userId ?? null;
  } catch {
    return null;
  }
}

export async function getUserFromRequest(
  req: any,
): Promise<typeof usersTable.$inferSelect | null> {
  try {
    const auth = req.headers["authorization"];

    if (!auth || !auth.startsWith("Bearer ")) {
      return null;
    }

    const token = auth.slice(7);

    const userId = await getUserIdFromToken(token);

    if (!userId) {
      return null;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    return user ?? null;
  } catch {
    return null;
  }
}

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid input",
      details: parsed.error,
    });
  }

  const { username, password } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username));

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const token = generateToken();

    await db.insert(sessionsTable).values({
      token,
      userId: user.id,
    });

    return res.json({
      user: serializeUser(user),
      token,
    });
  } catch (err) {
    logger.error({ err }, "Login error");

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

router.post("/auth/logout", async (req, res) => {
  try {
    const auth = req.headers["authorization"];

    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice(7);
      await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Logout error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/auth/me", async (req, res) => {
  try {
    const auth = req.headers["authorization"];

    if (!auth) {
      return res.json({
        message: "route working",
      });
    }

    const user = await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.json(serializeUser(user));
  } catch (err) {
    logger.error({ err }, "Auth/me error");

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

export default router;
