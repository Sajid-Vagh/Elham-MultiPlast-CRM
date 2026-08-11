import app from "./app";
import bcrypt from "bcryptjs";
import cron from "node-cron";
import { logger } from "./lib/logger";
import { closeDb, waitForDb, db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedUsers() {
  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length > 0) {
    logger.info("Users already exist, skipping seed");
    return;
  }

  logger.info("No users found, seeding default users...");

  const users = [
    { name: "Admin", username: "admin", password: "admin123", role: "admin", colorCode: "#6366f1", unit: "All", canViewAllReports: true, canAssignLeads: true },
    { name: "Ravi", username: "ravi", password: "elham2024", role: "sales", colorCode: "#ef4444", unit: "Himatnagar", canViewAllReports: false, canAssignLeads: false },
    { name: "Sneha", username: "sneha", password: "elham2024", role: "sales", colorCode: "#f59e0b", unit: "Surat", canViewAllReports: false, canAssignLeads: false },
    { name: "Mohit", username: "mohit", password: "elham2024", role: "sales", colorCode: "#10b981", unit: "Rajkot", canViewAllReports: false, canAssignLeads: false },
    { name: "Priya", username: "priya", password: "elham2024", role: "sales", colorCode: "#3b82f6", unit: "Himatnagar", canViewAllReports: false, canAssignLeads: false },
    { name: "Deepak", username: "deepak", password: "elham2024", role: "sales", colorCode: "#8b5cf6", unit: "Surat", canViewAllReports: false, canAssignLeads: false },
    { name: "Kavita", username: "kavita", password: "elham2024", role: "sales", colorCode: "#ec4899", unit: "Rajkot", canViewAllReports: false, canAssignLeads: false },
  ];

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await db.insert(usersTable).values({
      name: u.name,
      username: u.username,
      passwordHash,
      role: u.role,
      colorCode: u.colorCode,
      unit: u.unit,
      canViewAllReports: u.canViewAllReports,
      canAssignLeads: u.canAssignLeads,
    }).onConflictDoNothing({ target: usersTable.username });
    logger.info(`Seeded user: ${u.username}`);
  }

  logger.info("Seed complete!");
}

async function main() {
  try {
    logger.info("Connecting to database...");
    await waitForDb(30, 2000);
    logger.info("Database connected");

    // Ensure the storage.objects RLS public-read policy exists — boot-time
    // self-heal for the Supabase Storage 403 / profile-photo initials fallback.
    // Equivalent to applying migration 072_add_storage_public_read_policies.sql;
    // runs once per process and is idempotent, so existing deployments repair
    // themselves on next startup without a manual SQL step.
    try {
      const { ensurePublicReadPolicies } = await import("./lib/storage");
      await ensurePublicReadPolicies();
    } catch (err) {
      logger.warn({ err }, "Storage RLS public-read policy setup failed (non-critical)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to connect to database after retries");
    process.exit(1);
  }

  try {
    await seedUsers();
  } catch (err) {
    logger.error({ err }, "Failed to seed users");
  }

  // Ensure uploads directory exists at startup for local file storage
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    logger.info({ dir: uploadsDir }, "Created uploads directory");
  }
  const docsDir = path.join(uploadsDir, "documents");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    logger.info({ dir: docsDir }, "Created documents subdirectory");
  }

  // Warn if Supabase is not configured — voice notes will use ephemeral local storage
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    logger.warn("[STORAGE] SUPABASE_URL / SUPABASE_KEY not set. Using local filesystem — files will be lost on deploy/restart. Voice notes require Supabase for persistence.");
  }

  // Auto-backfill production_order_items for pre-existing orders (non-blocking)
  (async () => {
    try {
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`
        SELECT po.id, po.proforma_invoice_id
        FROM production_orders po
        WHERE po.proforma_invoice_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM production_order_items poi WHERE poi.production_order_id = po.id
          )
      `);
      const orders = (rows.rows || []) as { id: number; proforma_invoice_id: number }[];
      if (orders.length > 0) {
        const { syncProductionOrderItems } = await import("./lib/production-service");
        let synced = 0;
        for (const o of orders) {
          try {
            await syncProductionOrderItems(o.id, o.proforma_invoice_id);
            synced++;
          } catch { /* skip */ }
        }
        logger.info({ total: orders.length, synced }, "Backfilled production_order_items for existing orders");
      }
    } catch (err) {
      logger.warn({ err }, "Startup backfill of production_order_items failed (non-critical)");
    }
  })();

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Daily orphan voice note cleanup — runs every 24 hours
  const VOICE_NOTE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    try {
      const { cleanupOrphanVoiceNotes } = await import("./lib/voice-notes-service");
      const result = await cleanupOrphanVoiceNotes();
      if (result.deletedCount > 0) {
        logger.info({ deletedCount: result.deletedCount }, "Daily orphan voice note cleanup completed");
      }
    } catch (err) {
      logger.error({ err }, "Voice note orphan cleanup failed");
    }
  }, VOICE_NOTE_CLEANUP_INTERVAL);
  logger.info("Voice note orphan cleanup scheduled (every 24h)");

  // ── Automated storage cleanup: purge voice-note audio files 90 days after an
  //    order is marked 'Delivered'/'Completed'. Runs daily at midnight.
  //    Database rows + transcripts are never deleted — only the physical files.
  cron.schedule("0 0 * * *", async () => {
    try {
      const { cleanupDeliveredOrderVoiceNotes } = await import("./lib/voice-notes-cleanup");
      const result = await cleanupDeliveredOrderVoiceNotes();
      if (result.scanned > 0 || result.purged > 0) {
        logger.info({ ...result }, "Daily voice note retention cleanup completed");
      }
    } catch (err) {
      logger.error({ err }, "Daily voice note retention cleanup failed");
    }
  }, { timezone: process.env.TZ || "Asia/Kolkata" });
  logger.info("Voice note retention cleanup scheduled (daily at midnight)");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    server.close(async () => {
      await closeDb();
      logger.info("Server shut down");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

main();
