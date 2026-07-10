import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const orderRevisionsTable = pgTable("order_revisions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  changedBy: integer("changed_by").notNull().references(() => usersTable.id),
  department: text("department"),
  reason: text("reason").notNull(),
  changes: jsonb("changes").notNull(),
  previousData: jsonb("previous_data"),
  newData: jsonb("new_data"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const REVISION_TYPES = [
  "Increase Quantity",
  "Decrease Quantity",
  "Add Product",
  "Remove Product",
  "Change Bottle",
  "Change Cap",
  "Change Weight",
  "Change Color",
  "Change Label",
  "Change Packaging",
  "Change Delivery Date",
  "Change Dispatch Address",
  "Change Transport",
  "Change Payment Terms",
  "Customer Remarks",
  "Other",
] as const;
export type RevisionType = typeof REVISION_TYPES[number];

export const insertOrderRevisionSchema = createInsertSchema(orderRevisionsTable).omit({ id: true, createdAt: true });
export type InsertOrderRevision = z.infer<typeof insertOrderRevisionSchema>;
export type OrderRevision = typeof orderRevisionsTable.$inferSelect;
