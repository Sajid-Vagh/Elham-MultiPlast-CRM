import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { getUserFromRequest, getUserIdFromToken } from "./auth";
import { notificationEmitter, NOTIFICATION_EVENT } from "../lib/notification-emitter";

const router: IRouter = Router();

async function getUser(req: Request, res: Response) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

// SSE stream for real-time notifications
router.get("/notifications/stream", async (req: Request, res: Response) => {
  let user = await getUserFromRequest(req);
  if (!user && req.query.token) {
    const userId = getUserIdFromToken(req.query.token as string);
    if (userId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      user = u ?? null;
    }
  }
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(": connected\n\n");

  const onNotification = (notification: any) => {
    if (notification.userId === user.id) {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    }
  };

  notificationEmitter.on(NOTIFICATION_EVENT, onNotification);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    notificationEmitter.off(NOTIFICATION_EVENT, onNotification);
  });
});

// List notifications for current user
router.get("/notifications", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, user.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, user.id));

    res.json({ notifications: rows, total: Number(count) });
  } catch (err) {
    req.log.error({ err }, "List notifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get unread count
router.get("/notifications/unread-count", async (req: Request, res: Response) => {
  try {
    let user: typeof usersTable.$inferSelect | null = null;
    try {
      user = await getUserFromRequest(req);
    } catch (err) {
      req.log.error({ err }, "getUserFromRequest failed in unread-count");
    }
    if (!user) {
      res.json({ unread: 0 });
      return;
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, user.id), isNull(notificationsTable.readAt)));

    res.json({ unread: Number(count) });
  } catch (err) {
    req.log.error({ err }, "Unread count error — returning 0");
    res.json({ unread: 0 });
  }
});

// Mark single notification as read
router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;

  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [n] = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
      .returning();

    if (!n) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(n);
  } catch (err) {
    req.log.error({ err }, "Mark read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark all as read
router.post("/notifications/read-all", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;

  try {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.userId, user.id), isNull(notificationsTable.readAt)));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark all read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper to create a notification and emit it via SSE
export async function createNotification(params: {
  userId: number;
  type: string;
  title: string;
  message: string;
  link?: string;
  relatedId?: number;
  relatedType?: string;
}) {
  const [n] = await db.insert(notificationsTable).values(params).returning();
  if (n) {
    notificationEmitter.emit(NOTIFICATION_EVENT, n);
  }
  return n;
}

export default router;
