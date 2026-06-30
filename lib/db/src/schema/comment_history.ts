import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const commentHistoryTable = pgTable("comment_history", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  comment: text("comment").notNull(),
  updatedBy: integer("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommentHistory = typeof commentHistoryTable.$inferSelect;
