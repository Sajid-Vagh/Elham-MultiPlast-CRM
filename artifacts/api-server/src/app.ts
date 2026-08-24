import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { UPLOADS_ROOT } from "./lib/storage";
import { getUserFromRequest } from "./routes/auth";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { gt } from "drizzle-orm";

const app: Express = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for CRM with inline scripts/styles
  crossOriginEmbedderPolicy: false,
}));

// CORS — restrict to known origins in production
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173").split(",").map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      return callback(null, true);
    }
    return callback(null, true); // In dev, allow all. In prod, restrict.
  },
  credentials: true,
}));

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url?.split("?")[0],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/uploads", express.static(UPLOADS_ROOT, { dotfiles: "deny" }));

// ─── Public auth routes (no auth required) ────────────────
const PUBLIC_AUTH_ROUTES = new Set([
  "POST:/api/auth/login",
  "POST:/api/auth/admin/setup",
  "GET:/api/auth/setup-status",
  "POST:/api/auth/forgot-password",
  "POST:/api/auth/reset-password",
  "POST:/api/auth/verify-email",
  "POST:/api/auth/resend-verification",
  "POST:/api/auth/google",
  "GET:/api/auth/google/callback",
  "POST:/api/auth/invitations/accept",
]);

// Global auth middleware — protects all /api/* routes except public ones
app.use("/api", async (req, res, next) => {
  // NOTE: inside app.use("/api", ...) req.path/url are RELATIVE to the mount
  // point (prefix stripped by Express), so the allowlist keys must be matched
  // against req.originalUrl (which always retains the full path).
  const fullPath = (req.originalUrl || req.url || "").split("?")[0];
  const routeKey = `${req.method}:${fullPath}`;

  // Allow public routes
  if (PUBLIC_AUTH_ROUTES.has(routeKey)) {
    return next();
  }

  // Allow health check
  if (req.path === "/health" || fullPath === "/api/health") {
    return next();
  }

  // Allow static file serving
  if (req.path.startsWith("/uploads")) {
    return next();
  }

  // Check authentication
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = auth.slice(7);
  try {
    const now = new Date();
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token));

    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check session expiry
    if (session.expiresAt && session.expiresAt < now) {
      return res.status(401).json({ error: "Session expired" });
    }

    // Check user exists and is active
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.userId));

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Update lastUsedAt (fire and forget)
    db.update(sessionsTable)
      .set({ lastUsedAt: now })
      .where(eq(sessionsTable.id, session.id))
      .catch(() => {});

    // Attach user to request for downstream route handlers
    const { passwordHash: _, ...safeUser } = user;
    (req as any).user = safeUser;

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
});

app.use("/api", router);

app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error({ err: err?.message, type: err?.type }, "Unhandled route error");

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  res.status(err?.status ?? 500).json({
    success: false,
    error: "Internal Server Error",
  });
});

export default app;
