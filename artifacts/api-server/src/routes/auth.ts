console.log("AUTH ROUTE LOADED");

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

function generateToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

export async function getUserIdFromToken(token: string): Promise<number | null> {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token));
  return session?.userId ?? null;
}

export async function getUserFromRequest(
  req: any,
): Promise<typeof usersTable.$inferSelect | null> {
  const auth = req.headers["authorization"];

  console.log("AUTH HEADER:", auth);

  if (!auth || !auth.startsWith("Bearer ")) {
    console.log("AUTH RESULT: missing or malformed header");
    return null;
  }

  const token = auth.slice(7);
  console.log("TOKEN EXTRACTED:", token.slice(0, 20) + "...");

  const userId = await getUserIdFromToken(token);
  console.log("USER ID FROM TOKEN:", userId);

  if (!userId) {
    console.log("AUTH RESULT: no session found for token");
    return null;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  console.log("AUTH RESULT: user found =", !!user);

  return user ?? null;
}

router.post("/auth/login", async (req, res) => {
  console.log("LOGIN ROUTE HIT");
  console.log("BODY:", req.body);

  const parsed = LoginBody.safeParse(req.body);

  if (!parsed.success) {
    console.log("INVALID BODY:", parsed.error);

    return res.status(400).json({
      error: "Invalid input",
      details: parsed.error,
    });
  }

  const { username, password } = parsed.data;

  console.log("USERNAME:", username);

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username));

    console.log("USER FOUND:", !!user);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    console.log("PASSWORD VALID:", valid);

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

    console.log("SESSION CREATED: token=" + token.slice(0, 20) + "... userId=" + user.id);

    const { passwordHash: _, ...safeUser } = user;

    return res.json({
      user: safeUser,
      token,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
      message:
        err instanceof Error
          ? err.message
          : String(err),
    });
  }
});

router.post("/auth/logout", async (req, res) => {
  const auth = req.headers["authorization"];

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
    console.log("SESSION DELETED: token=" + token.slice(0, 20) + "...");
  }

  res.json({ ok: true });
});

router.get("/auth/me", async (req, res) => {
  console.log("AUTH ME ROUTE HIT");

  try {
    const auth = req.headers["authorization"];

    console.log("AUTH HEADER:", auth);

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
    console.error("AUTH ME ERROR:", err);

    return res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : String(err),
    });
  }
});

export default router;
