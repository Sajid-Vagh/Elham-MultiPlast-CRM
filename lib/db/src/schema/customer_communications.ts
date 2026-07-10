import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const COMMUNICATION_TYPES = [
  "Phone Call",
  "WhatsApp",
  "Email",
  "Meeting",
  "Factory Visit",
  "Video Call",
  "Complaint",
  "Reminder",
  "Follow-up",
] as const;
export type CommunicationType = typeof COMMUNICATION_TYPES[number];

export const customerCommunicationsTable = pgTable("customer_communications", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id"),
  type: text("type").notNull(),
  direction: text("direction").default("Outbound"),
  notes: text("notes").notNull(),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  department: text("department"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCustomerCommunicationSchema = createInsertSchema(customerCommunicationsTable).omit({ id: true, createdAt: true });
export type InsertCustomerCommunication = z.infer<typeof insertCustomerCommunicationSchema>;
export type CustomerCommunication = typeof customerCommunicationsTable.$inferSelect;
