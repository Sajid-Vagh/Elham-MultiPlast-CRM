import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gstVerificationLogTable = pgTable("gst_verification_log", {
  id: serial("id").primaryKey(),
  gstin: text("gstin").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy: integer("verified_by").references(() => usersTable.id, { onDelete: "set null" }),
  ipAddress: text("ip_address"),
  responseTimeMs: integer("response_time_ms"),
  success: boolean("success").notNull(),
  responseData: jsonb("response_data"),
  errorMessage: text("error_message"),
});

export type GstVerificationLog = typeof gstVerificationLogTable.$inferSelect;
