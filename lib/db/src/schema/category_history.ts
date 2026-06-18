import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const categoryHistoryTable = pgTable("category_history", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  previousCategory: text("previous_category"),
  newCategory: text("new_category").notNull(),
  changedBy: integer("changed_by").notNull().references(() => usersTable.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCategoryHistorySchema = createInsertSchema(categoryHistoryTable).omit({ id: true, createdAt: true });
export type InsertCategoryHistory = z.infer<typeof insertCategoryHistorySchema>;
export type CategoryHistory = typeof categoryHistoryTable.$inferSelect;
