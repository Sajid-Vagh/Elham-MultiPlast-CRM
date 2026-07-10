import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const internalNotesTable = pgTable("internal_notes", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  department: text("department"),
  isPinned: boolean("is_pinned").notNull().default(false),
  isResolved: boolean("is_resolved").notNull().default(false),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInternalNoteSchema = createInsertSchema(internalNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInternalNote = z.infer<typeof insertInternalNoteSchema>;
export type InternalNote = typeof internalNotesTable.$inferSelect;
