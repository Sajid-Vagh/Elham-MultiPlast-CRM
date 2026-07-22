import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
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

    const { passwordHash: _, ...safeUser } = user;

    return res.json({
      user: safeUser,
      token,
    });
  } catch (err) {
    logger.error({ err }, "Login error");

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/auth/logout", async (req, res) => {
  const auth = req.headers["authorization"];

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }

  res.json({ ok: true });
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

    const { passwordHash: _, ...safeUser } = user;

    return res.json(safeUser);
  } catch (err) {
    logger.error({ err }, "Auth/me error");

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;
