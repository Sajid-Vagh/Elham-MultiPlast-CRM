import { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, gt, and } from "drizzle-orm";
import { logger } from "./logger";

// ─── Types ──────────────────────────────────────────────────
export interface AuthenticatedSocket extends Socket {
  userId: number;
  userRole: string;
  userName: string;
}

// Server → Client events
export interface ServerToClientEvents {
  "enquiry:created": (data: { contactId: number }) => void;
  "enquiry:updated": (data: { contactId: number }) => void;
  "enquiry:assigned": (data: { contactId: number; assignedTo: number }) => void;
  "enquiry:deleted": (data: { contactId: number }) => void;
  "deal:created": (data: { dealId: number; contactId: number }) => void;
  "deal:updated": (data: { dealId: number; contactId: number }) => void;
  "followup:created": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "followup:updated": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "activity:created": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "notification:new": (data: { notificationId: number; userId: number }) => void;
  "order:created": (data: { orderId: number }) => void;
  "order:updated": (data: { orderId: number }) => void;
  "production:created": (data: { orderId: number }) => void;
  "production:updated": (data: { orderId: number }) => void;
  "production:status_changed": (data: { orderId: number; status: string }) => void;
  "production:chat": (data: { orderId: number; senderId: number; senderName: string; senderRole: string }) => void;
  "proforma:updated": (data: { invoiceId: number; dealId?: number | null; contactId?: number | null }) => void;
}

// Client → Server events
export interface ClientToServerEvents {
  "join:order": (orderId: number) => void;
  "leave:order": (orderId: number) => void;
}

// ─── Module state ───────────────────────────────────────────
type AnyEvents = Record<string, (...args: any[]) => void>;
let io: Server<AnyEvents, ServerToClientEvents> | null = null;

/**
 * Initialize Socket.IO on the existing HTTP server.
 * Must be called AFTER the Express app is created but BEFORE app.listen().
 */
export function initSocket(httpServer: HttpServer): Server<AnyEvents, ServerToClientEvents> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const allowedOrigins = (process.env.CORS_ORIGINS || frontendUrl)
    .split(",")
    .map((s) => s.trim());

  io = new Server<AnyEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
  });

  // ─── Authentication middleware ────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      if (!token || typeof token !== "string") {
        return next(new Error("Authentication required"));
      }

      const now = new Date();
      const [session] = await db
        .select()
        .from(sessionsTable)
        .where(and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, now)));

      if (!session) {
        return next(new Error("Invalid or expired session"));
      }

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, session.userId));

      if (!user || !user.isActive) {
        return next(new Error("User not found or inactive"));
      }

      // Attach identity to socket — server-side validated, never trusted from client
      (socket as AuthenticatedSocket).userId = user.id;
      (socket as AuthenticatedSocket).userRole = user.role;
      (socket as AuthenticatedSocket).userName = user.name;

      // Fire-and-forget: update session lastUsedAt
      db.update(sessionsTable)
        .set({ lastUsedAt: now })
        .where(eq(sessionsTable.id, session.id))
        .catch(() => {});

      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  // ─── Connection handler ──────────────────────────────────
  io.on("connection", (socket) => {
    const s = socket as AuthenticatedSocket;
    logger.info({ userId: s.userId, role: s.userRole }, "Socket connected");

    // Auto-join user-specific room for targeted events
    s.join(`user:${s.userId}`);

    // Join role rooms so role-based broadcasts work
    s.join(`role:${s.userRole}`);

    // Admin joins admin room
    if (s.userRole === "admin") {
      s.join("role:admin");
    }

    // Production-related roles join production room
    if (["production", "production_and_support", "admin"].includes(s.userRole)) {
      s.join("role:production");
    }

    // Support-related roles join support room
    if (["production_and_support", "admin", "sales", "production"].includes(s.userRole)) {
      s.join("role:support");
    }

    // Sales roles join sales room
    if (["sales", "admin", "production_and_support"].includes(s.userRole)) {
      s.join("role:sales");
    }

    // Order chat rooms — join/leave on demand
    s.on("join:order", (orderId: number) => {
      if (typeof orderId === "number" && orderId > 0) {
        s.join(`order:${orderId}`);
      }
    });

    s.on("leave:order", (orderId: number) => {
      if (typeof orderId === "number" && orderId > 0) {
        s.leave(`order:${orderId}`);
      }
    });

    s.on("disconnect", (reason) => {
      logger.info({ userId: s.userId, reason }, "Socket disconnected");
    });
  });

  logger.info("Socket.IO initialized");
  return io;
}

/**
 * Get the Socket.IO server instance.
 * Returns null if initSocket() has not been called yet.
 */
export function getIO(): Server<AnyEvents, ServerToClientEvents> | null {
  return io;
}

// ─── Emit helpers (called from route handlers after DB writes) ──

function emit<T>(event: string, room: string, data: T) {
  if (!io) return;
  io.to(room).emit(event as any, data);
}

function emitToUser<T>(event: string, userId: number, data: T) {
  emit(event, `user:${userId}`, data);
}

function emitToRole<T>(event: string, role: string, data: T) {
  emit(event, `role:${role}`, data);
}

function emitToOrder<T>(event: string, orderId: number, data: T) {
  emit(event, `order:${orderId}`, data);
}

// ─── Contact / Enquiry events ───────────────────────────────

export function emitEnquiryCreated(contactId: number, salesOwnerId: number | null) {
  emitToRole("enquiry:created", "admin", { contactId });
  if (salesOwnerId) emitToUser("enquiry:created", salesOwnerId, { contactId });
}

export function emitEnquiryUpdated(contactId: number, salesOwnerId: number | null) {
  emitToRole("enquiry:updated", "admin", { contactId });
  if (salesOwnerId) emitToUser("enquiry:updated", salesOwnerId, { contactId });
}

export function emitEnquiryAssigned(contactId: number, assignedTo: number) {
  emitToUser("enquiry:assigned", assignedTo, { contactId, assignedTo });
  emitToRole("enquiry:assigned", "admin", { contactId, assignedTo });
}

export function emitEnquiryDeleted(contactId: number) {
  emitToRole("enquiry:deleted", "admin", { contactId });
}

// ─── Deal events ────────────────────────────────────────────

export function emitDealCreated(dealId: number, contactId: number, salesOwnerId: number | null) {
  emitToRole("deal:created", "admin", { dealId, contactId });
  if (salesOwnerId) emitToUser("deal:created", salesOwnerId, { dealId, contactId });
}

export function emitDealUpdated(dealId: number, contactId: number, salesOwnerId: number | null) {
  emitToRole("deal:updated", "admin", { dealId, contactId });
  if (salesOwnerId) emitToUser("deal:updated", salesOwnerId, { dealId, contactId });
}

// ─── Activity / Follow-up events ────────────────────────────

export function emitFollowupCreated(activityId: number, contactId?: number, dealId?: number, assignedTo?: number | null) {
  const data = { activityId, contactId, dealId };
  emitToRole("followup:created", "admin", data);
  if (assignedTo) emitToUser("followup:created", assignedTo, data);
}

export function emitFollowupUpdated(activityId: number, contactId?: number, dealId?: number) {
  const data = { activityId, contactId, dealId };
  emitToRole("followup:updated", "admin", data);
}

export function emitActivityCreated(activityId: number, contactId?: number, dealId?: number) {
  const data = { activityId, contactId, dealId };
  emitToRole("activity:created", "admin", data);
}

// ─── Notification events ────────────────────────────────────

export function emitNotificationNew(notificationId: number, userId: number) {
  emitToUser("notification:new", userId, { notificationId, userId });
}

// ─── Order events ───────────────────────────────────────────

export function emitOrderCreated(orderId: number) {
  emitToRole("order:created", "admin", { orderId });
  emitToRole("order:created", "sales", { orderId });
  emitToRole("order:created", "support", { orderId });
}

export function emitOrderUpdated(orderId: number) {
  emitToRole("order:updated", "admin", { orderId });
  emitToRole("order:updated", "sales", { orderId });
  emitToRole("order:updated", "support", { orderId });
}

// ─── Production events ──────────────────────────────────────

export function emitProductionCreated(orderId: number) {
  emitToRole("production:created", "production", { orderId });
  emitToRole("production:created", "admin", { orderId });
}

export function emitProductionUpdated(orderId: number) {
  emitToRole("production:updated", "production", { orderId });
  emitToRole("production:updated", "admin", { orderId });
  emitToRole("production:updated", "support", { orderId });
}

export function emitProductionStatusChanged(orderId: number, status: string) {
  const data = { orderId, status };
  emitToRole("production:status_changed", "production", data);
  emitToRole("production:status_changed", "admin", data);
  emitToRole("production:status_changed", "support", data);
}

export function emitProductionChat(orderId: number, senderId: number, senderName: string, senderRole: string) {
  const data = { orderId, senderId, senderName, senderRole };
  emitToOrder("production:chat", orderId, data);
  emitToRole("production:chat", "production", data);
  emitToRole("production:chat", "admin", data);
  emitToRole("production:chat", "support", data);
  emitToRole("production:chat", "sales", data);
}

// ─── Proforma Invoice events ────────────────────────────────

export function emitProformaUpdated(invoiceId: number, dealId?: number | null, contactId?: number | null) {
  const data = { invoiceId, dealId, contactId };
  emitToRole("proforma:updated", "admin", data);
  emitToRole("proforma:updated", "sales", data);
  emitToRole("proforma:updated", "support", data);
}
