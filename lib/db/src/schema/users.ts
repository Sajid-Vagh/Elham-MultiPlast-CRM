import { pgTable, text, serial, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("sales"),
  colorCode: text("color_code").notNull().default("#6366f1"),
  unit: text("unit").notNull().default("All"),
  profilePhoto: text("profile_photo"),
  canViewAllReports: boolean("can_view_all_reports").notNull().default(false),
  canAssignLeads: boolean("can_assign_leads").notNull().default(false),
  permissions: jsonb("permissions").$type<Record<string, boolean>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Auth security upgrade columns
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
  resetToken: text("reset_token"),
  resetExpiresAt: timestamp("reset_expires_at", { withTimezone: true }),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  googleId: text("google_id"),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
