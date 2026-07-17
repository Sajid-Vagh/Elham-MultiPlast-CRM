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

function deriveModule(type: string): string {
  if (type.startsWith("enquiry_") || type.startsWith("lead_")) return "Lead";
  if (type.startsWith("follow_up")) return "Follow-up";
  if (type.startsWith("deal_")) return "Deal";
  if (type === "assignment") return "Lead";
  if (type.startsWith("production_")) return "Production";
  if (type.startsWith("invoice_")) return "Invoice";
  if (type.startsWith("user_")) return "User";
  if (type.startsWith("product_")) return "Product";
  return "General";
}

function formatNotification(row: any) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    relatedId: row.relatedId,
    relatedType: row.relatedType,
    readAt: row.readAt,
    createdAt: row.createdAt,
    notificationSeen: row.notificationSeen,
    notificationSeenAt: row.notificationSeenAt,
    soundPlayed: row.soundPlayed,
    reminderShown: row.reminderShown,
    reminderSoundPlayed: row.reminderSoundPlayed,
    isRead: row.readAt !== null,
    module: deriveModule(row.type),
  };
}

// SSE stream for real-time notifications
router.get("/notifications/stream", async (req: Request, res: Response) => {
  let user = await getUserFromRequest(req);
  if (!user && req.query.token) {
    const userId = await getUserIdFromToken(req.query.token as string);
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

// Get notification history with filters (all, unread, unseen, today, this_week, older)
// THIS is the single canonical endpoint for reading notifications
router.get("/notifications/history", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filter = (req.query.filter as string) || "all";

  try {
    const conditions: any[] = [eq(notificationsTable.userId, user.id)];

    if (filter === "unread" || filter === "unseen") {
      conditions.push(isNull(notificationsTable.readAt));
    } else if (filter === "today") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      conditions.push(sql`${notificationsTable.createdAt} >= ${today.toISOString()}`);
    } else if (filter === "this_week") {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      startOfWeek.setHours(0, 0, 0, 0);
      conditions.push(sql`${notificationsTable.createdAt} >= ${startOfWeek.toISOString()}`);
    } else if (filter === "older") {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      startOfWeek.setHours(0, 0, 0, 0);
      conditions.push(sql`${notificationsTable.createdAt} < ${startOfWeek.toISOString()}`);
    }

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(and(...conditions));

    res.json({
      notifications: rows.map(formatNotification),
      total: Number(count),
    });
  } catch (err) {
    req.log.error({ err }, "List notification history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get unread count (used by bell badge)
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
      .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.notificationSeen, false), isNull(notificationsTable.readAt)));

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

// Mark notification as seen (acknowledged)
router.patch("/notifications/:id/seen", async (req: Request, res: Response) => {
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
      .set({ notificationSeen: true, notificationSeenAt: new Date() })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
      .returning();

    if (!n) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(n);
  } catch (err) {
    req.log.error({ err }, "Mark seen error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark notification as seen by related entity (activity)
router.patch("/notifications/seen-by-related", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;

  const { relatedId, relatedType } = req.body;
  if (!relatedId || !relatedType) {
    res.status(400).json({ error: "relatedId and relatedType are required" });
    return;
  }

  try {
    const [n] = await db
      .update(notificationsTable)
      .set({ notificationSeen: true, notificationSeenAt: new Date() })
      .where(and(
        eq(notificationsTable.userId, user.id),
        eq(notificationsTable.relatedId, Number(relatedId)),
        eq(notificationsTable.relatedType, relatedType as string),
        eq(notificationsTable.notificationSeen, false),
      ))
      .returning();

    res.json({ success: true, notification: n ?? null });
  } catch (err) {
    req.log.error({ err }, "Mark seen by related error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark notification sound as played
router.patch("/notifications/:id/mark-sound-played", async (req: Request, res: Response) => {
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
      .set({ soundPlayed: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
      .returning();

    if (!n) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(n);
  } catch (err) {
    req.log.error({ err }, "Mark sound played error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark follow-up reminder as shown and sound played
router.patch("/notifications/:id/mark-reminder", async (req: Request, res: Response) => {
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
      .set({ reminderShown: true, reminderSoundPlayed: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
      .returning();

    if (!n) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(n);
  } catch (err) {
    req.log.error({ err }, "Mark reminder error");
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
// Skips creation if an identical unread notification already exists
// (same userId, type, relatedId, relatedType, and still unread)
export async function createNotification(params: {
  userId: number;
  type: string;
  title: string;
  message: string;
  link?: string;
  relatedId?: number;
  relatedType?: string;
}) {
  if (params.relatedId != null && params.relatedType) {
    const [existing] = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, params.userId),
        eq(notificationsTable.type, params.type),
        eq(notificationsTable.relatedId, params.relatedId),
        eq(notificationsTable.relatedType, params.relatedType),
        eq(notificationsTable.notificationSeen, false),
        isNull(notificationsTable.readAt),
      ))
      .limit(1);

    if (existing) {
      return existing;
    }
  } else {
    const [existing] = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, params.userId),
        eq(notificationsTable.type, params.type),
        eq(notificationsTable.title, params.title),
        eq(notificationsTable.notificationSeen, false),
        isNull(notificationsTable.readAt),
      ))
      .limit(1);

    if (existing) {
      return existing;
    }
  }

  const [n] = await db.insert(notificationsTable).values(params).returning();
  if (n) {
    notificationEmitter.emit(NOTIFICATION_EVENT, n);
  }
  return n;
}

// Delete notification (admin only)
router.delete("/notifications/:id", async (req: Request, res: Response) => {
  const user = await getUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    await db.delete(notificationsTable).where(eq(notificationsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete notification error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
