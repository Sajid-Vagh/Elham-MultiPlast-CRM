import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { ordersTable } from "./orders";

export const EXISTING_CUSTOMER_STATUSES = [
  "Active",
  "Production Running",
  "Dispatch Pending",
  "Repeat Order Due",
  "Complaint Open",
  "Inactive",
] as const;
export type ExistingCustomerStatus = typeof EXISTING_CUSTOMER_STATUSES[number];

export const existingCustomersTable = pgTable("existing_customers", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }).unique(),
  salesOwnerId: integer("sales_owner_id").notNull().references(() => usersTable.id, { onDelete: "set null" }),
  supportOwnerId: integer("support_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  firstOrderId: integer("first_order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  lastOrderId: integer("last_order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  totalOrders: integer("total_orders").notNull().default(0),
  repeatOrderCount: integer("repeat_order_count").notNull().default(0),
  firstOrderDate: text("first_order_date"),
  lastOrderDate: text("last_order_date"),
  lastProductName: text("last_product_name"),
  repeatOrderDueDate: text("repeat_order_due_date"),
  currentProductionStatus: text("current_production_status"),
  currentDispatchStatus: text("current_dispatch_status"),
  activeComplaintId: integer("active_complaint_id"),
  activeComplaintNumber: text("active_complaint_number"),
  status: text("status").notNull().default("Active"),
  totalRevenue: numeric("total_revenue", { precision: 14, scale: 2 }).default("0"),
  firstOrderAt: timestamp("first_order_at", { withTimezone: true }),
  lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExistingCustomerSchema = createInsertSchema(existingCustomersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExistingCustomer = z.infer<typeof insertExistingCustomerSchema>;
export type ExistingCustomer = typeof existingCustomersTable.$inferSelect;
