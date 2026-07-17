import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const COMPLAINT_TYPES = [
  "Bottle Leakage",
  "Bottle Weight",
  "Bottle Color",
  "Cap Fitting",
  "Printing Issue",
  "Quantity Difference",
  "Damage",
  "Dispatch Issue",
  "Transport Issue",
  "Other",
] as const;
export type ComplaintType = typeof COMPLAINT_TYPES[number];

export const COMPLAINT_STATUSES = [
  "Open",
  "Assigned",
  "Investigation",
  "Production Review",
  "Replacement Approved",
  "Replacement Running",
  "Replacement Dispatched",
  "Closed",
  "Rejected",
] as const;
export type ComplaintStatus = typeof COMPLAINT_STATUSES[number];

export const complaintsTable = pgTable("complaints", {
  id: serial("id").primaryKey(),
  complaintNumber: text("complaint_number").notNull().unique(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "restrict" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderItemId: integer("order_item_id"),
  customerName: text("customer_name").notNull(),
  productName: text("product_name"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }),
  complaintType: text("complaint_type").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Open"),
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  assignedDepartment: text("assigned_department"),
  replacementOrderId: integer("replacement_order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: integer("closed_by").references(() => usersTable.id, { onDelete: "set null" }),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const complaintUpdatesTable = pgTable("complaint_updates", {
  id: serial("id").primaryKey(),
  complaintId: integer("complaint_id").notNull().references(() => complaintsTable.id, { onDelete: "cascade" }),
  statusFrom: text("status_from"),
  statusTo: text("status_to").notNull(),
  notes: text("notes"),
  changedBy: integer("changed_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertComplaintSchema = createInsertSchema(complaintsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComplaint = z.infer<typeof insertComplaintSchema>;
export type Complaint = typeof complaintsTable.$inferSelect;

export const insertComplaintUpdateSchema = createInsertSchema(complaintUpdatesTable).omit({ id: true, createdAt: true });
export type InsertComplaintUpdate = z.infer<typeof insertComplaintUpdateSchema>;
export type ComplaintUpdate = typeof complaintUpdatesTable.$inferSelect;
