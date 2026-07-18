import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const unitHistoryTable = pgTable("unit_history", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  previousUnit: text("previous_unit"),
  newUnit: text("new_unit"),
  changedBy: integer("changed_by").notNull().references(() => usersTable.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUnitHistorySchema = createInsertSchema(unitHistoryTable).omit({ id: true, createdAt: true });
export type InsertUnitHistory = z.infer<typeof insertUnitHistorySchema>;
export type UnitHistory = typeof unitHistoryTable.$inferSelect;
