import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealsTable } from "./deals";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  notes: text("notes"),
  followUpDate: text("follow_up_date"),
  followUpTime: text("follow_up_time"),
  followUpType: text("follow_up_type"),
  callStatus: text("call_status").default("Pending"),
  notificationStatus: text("notification_status").default("none"),
  priority: text("priority").default("Medium"),
  reminder: text("reminder"),
  assignedTo: integer("assigned_to").references(() => usersTable.id),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  isEdited: boolean("is_edited").default(false).notNull(),
});

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
