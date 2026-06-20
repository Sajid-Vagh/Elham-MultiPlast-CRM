import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

const sessions = new Map<string, number>();

function generateToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

export function getUserIdFromToken(token: string): number | null {
  return sessions.get(token) ?? null;
}

export async function getUserFromRequest(
  req: any,
): Promise<typeof usersTable.$inferSelect | null> {
  const auth = req.headers["authorization"];

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.slice(7);
  const userId = sessions.get(token);

  if (!userId) {
    return null;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  return user ?? null;
}

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid input",
    });
  }

  const { username, password } = parsed.data;

  console.log("LOGIN REQUEST:", username);

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

    console.log("PASSWORD HASH:", !!user.passwordHash);

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

    sessions.set(token, user.id);

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

router.post("/auth/logout", (req, res) => {
  const auth = req.headers["authorization"];

  if (auth?.startsWith("Bearer ")) {
    sessions.delete(auth.slice(7));
  }

  res.json({ ok: true });
});

router.get("/auth/me", async (req, res) => {
  try {
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
      error: "Internal server error",
      message:
        err instanceof Error
          ? err.message
          : String(err),
    });
  }
});

export default router;