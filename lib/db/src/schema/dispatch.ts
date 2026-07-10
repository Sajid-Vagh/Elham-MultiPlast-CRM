import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const DISPATCH_STATUSES = [
  "Pending",
  "Vehicle Assigned",
  "Loaded",
  "Dispatched",
  "In Transit",
  "Delivered",
  "Delayed",
  "Returned",
  "Cancelled",
] as const;
export type DispatchStatus = typeof DISPATCH_STATUSES[number];

export const dispatchTable = pgTable("dispatch", {
  id: serial("id").primaryKey(),
  dispatchNumber: text("dispatch_number").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("Pending"),
  vehicleNumber: text("vehicle_number"),
  driverName: text("driver_name"),
  driverMobile: text("driver_mobile"),
  transportCompany: text("transport_company"),
  lrNumber: text("lr_number"),
  trackingNumber: text("tracking_number"),
  dispatchDate: text("dispatch_date"),
  expectedDeliveryDate: text("expected_delivery_date"),
  deliveredDate: text("delivered_date"),
  dispatchAddress: text("dispatch_address"),
  dispatchHandledBy: integer("dispatch_handled_by").references(() => usersTable.id, { onDelete: "set null" }),
  freight: numeric("freight", { precision: 14, scale: 2 }).default("0"),
  remarks: text("remarks"),
  proofOfDelivery: text("proof_of_delivery"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dispatchItemsTable = pgTable("dispatch_items", {
  id: serial("id").primaryKey(),
  dispatchId: integer("dispatch_id").notNull().references(() => dispatchTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id"),
  productName: text("product_name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  batchNumber: text("batch_number"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDispatchSchema = createInsertSchema(dispatchTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatchTable.$inferSelect;

export const insertDispatchItemSchema = createInsertSchema(dispatchItemsTable).omit({ id: true, createdAt: true });
export type InsertDispatchItem = z.infer<typeof insertDispatchItemSchema>;
export type DispatchItem = typeof dispatchItemsTable.$inferSelect;
