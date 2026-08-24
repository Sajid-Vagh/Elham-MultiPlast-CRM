import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});
