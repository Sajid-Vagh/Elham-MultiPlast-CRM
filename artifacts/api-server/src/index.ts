import app from "./app";
import bcrypt from "bcryptjs";
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

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

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
