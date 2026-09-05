import app from "./app";
import bcrypt from "bcryptjs";
import { logger } from "./lib/logger";
import { closeDb, waitForDb, db, usersTable, sessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { initSocket } from "./lib/socket";

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
  // Migration-safe: only seed when the database is completely empty.
  // If ANY user exists, preserve all existing data — no overwrites, no deletes.
  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length > 0) {
    logger.info("Users already exist, skipping seed — existing data preserved");
    return;
  }

  // Check if this is a fresh database with no admin
  const [adminCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));

  if ((adminCount?.count ?? 0) > 0) {
    logger.info("Admin exists, skipping seed");
    return;
  }

  // Fresh database: do NOT seed predictable credentials.
  // The first admin must use the secure /auth/admin/setup flow.
  logger.info("Fresh database detected — admin setup required. No users seeded.");
  logger.info("Navigate to /admin-setup to create the first Admin account.");
}

async function ensureDatabaseSchema() {
  try {
    // Migration 085: created_by_id and assigned_by_id on contacts
    await db.execute(sql`
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_contacts_created_by_id ON contacts(created_by_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_assigned_by_id ON contacts(assigned_by_id);
    `);

    // Backfill from notifications where available
    await db.execute(sql`
      UPDATE contacts c
      SET created_by_id = n.created_by_id,
          assigned_by_id = n.created_by_id
      FROM notifications n
      WHERE n.related_id = c.id
        AND n.related_type = 'contact'
        AND n.type IN ('assignment', 'enquiry_assigned')
        AND n.created_by_id IS NOT NULL
        AND c.created_by_id IS NULL;

      UPDATE contacts
      SET created_by_id = sales_owner_id,
          assigned_by_id = sales_owner_id
      WHERE created_by_id IS NULL;
    `);

    // Migration 084: is_hidden_from_timeline on deals
    await db.execute(sql`
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_hidden_from_timeline BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    logger.info("Database schema verified and up to date");
  } catch (err) {
    logger.warn({ err }, "Database schema self-heal check failed (non-critical)");
  }
}

async function main() {
  try {
    logger.info("Connecting to database...");
    await waitForDb(30, 2000);
    logger.info("Database connected");

    // Automatically ensure required database columns and migrations are applied on startup
    await ensureDatabaseSchema();

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

  // Create HTTP server first, then attach Socket.IO before listening
  const httpServer = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Attach Socket.IO to the same HTTP server (WebSocket upgrade shares port)
  initSocket(httpServer);

  const server = httpServer;

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

  // Client retention sweep — daily, plus one run shortly after boot so alerts
  // fire without waiting a full day. Generates at most ONE "Retention Alert"
  // per My Client per lapse cycle (deduped inside retention-service).
  const RETENTION_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const runRetentionCheck = async () => {
    try {
      const { runRetentionAlertCheck } = await import("./lib/retention-service");
      const result = await runRetentionAlertCheck();
      if (result.alerted > 0) {
        logger.info(result, "Client retention alert check completed");
      }
    } catch (err) {
      logger.error({ err }, "Client retention alert check failed");
    }
  };
  setTimeout(runRetentionCheck, 30_000);
  setInterval(runRetentionCheck, RETENTION_CHECK_INTERVAL);
  logger.info("Client retention alert check scheduled (every 24h)");

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
