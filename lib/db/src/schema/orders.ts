import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { dealsTable } from "./deals";

export const ORDER_STATUSES = [
  "Draft",
  "Pending Verification",
  "Confirmed",
  "Production Pending",
  "Production Started",
  "Production Running",
  "Quality Check",
  "Ready for Dispatch",
  "Partially Dispatched",
  "Dispatched",
  "Delivered",
  "Completed",
  "Cancelled",
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const ORDER_ITEM_STATUSES = [
  "Pending",
  "Production Pending",
  "Production Started",
  "Production Running",
  "Quality Check",
  "Ready for Dispatch",
  "Partially Dispatched",
  "Dispatched",
  "Delivered",
  "Completed",
  "Cancelled",
] as const;
export type OrderItemStatus = typeof ORDER_ITEM_STATUSES[number];

export const CANCELLATION_REASONS = [
  "Customer Cancelled",
  "Price Issue",
  "Quality Concern",
  "Duplicate Order",
  "Wrong Product",
  "Production Delay",
  "Payment Issue",
  "Other",
] as const;
export type CancellationReason = typeof CANCELLATION_REASONS[number];

export const ORDER_SOURCES = [
  "New Lead",
  "Existing Customer",
  "Repeat Order",
  "Walk-In Customer",
  "Factory Visit",
  "Direct Call",
  "WhatsApp",
  "Email",
  "Referral",
  "Website",
  "Exhibition",
  "Sales Visit",
  "Support Follow-up",
] as const;
export type OrderSource = typeof ORDER_SOURCES[number];

export const CUSTOMER_TYPES = [
  "New Customer",
  "Existing Customer",
  "Repeat Customer",
  "Dealer",
  "Distributor",
  "Export Customer",
  "Walk-In Customer",
] as const;
export type CustomerType = typeof CUSTOMER_TYPES[number];

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "restrict" }),
  customerName: text("customer_name").notNull(),
  companyName: text("company_name"),
  mobile: text("mobile"),
  email: text("email"),
  gstNumber: text("gst_number"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  source: text("source").notNull().default("New Lead"),
  customerType: text("customer_type").notNull().default("New Customer"),
  status: text("status").notNull().default("Draft"),
  salesOwnerId: integer("sales_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  supportOwnerId: integer("support_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  productionOwnerId: integer("production_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  verifiedBy: integer("verified_by").references(() => usersTable.id),
  dispatchHandledBy: integer("dispatch_handled_by").references(() => usersTable.id),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalGst: numeric("total_gst", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  freight: numeric("freight", { precision: 14, scale: 2 }).notNull().default("0"),
  transportMasterId: integer("transport_master_id"),
  transportCompany: text("transport_company"),
  freightChargeSnapshot: numeric("freight_charge_snapshot", { precision: 12, scale: 2 }),
  transitDaysSnapshot: integer("transit_days_snapshot"),
  paymentTerms: text("payment_terms"),
  deliveryTerms: text("delivery_terms"),
  expectedDeliveryDate: text("expected_delivery_date"),
  dispatchAddress: text("dispatch_address"),
  transportDetails: text("transport_details"),
  remarks: text("remarks"),
  quotationId: integer("quotation_id"),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  previousOrderId: integer("previous_order_id"),
  isRepeatOrder: boolean("is_repeat_order").notNull().default(false),
  healthStatus: text("health_status").notNull().default("Healthy"),
  productionUnit: text("production_unit"),
  productionRemarks: text("production_remarks"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: integer("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
  cancellationReason: text("cancellation_reason"),
  cancellationOtherReason: text("cancellation_other_reason"),
  cancellationNote: text("cancellation_note"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  productCode: text("product_code"),
  bottleType: text("bottle_type"),
  bottleWeight: text("bottle_weight"),
  capColour: text("cap_colour"),
  colour: text("colour"),
  hsnCode: text("hsn_code"),
  capacity: text("capacity"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull().default("Pcs"),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull().default("0"),
  gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }).default("0"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  packingMasterId: integer("packing_master_id"),
  linerPackingQty: integer("liner_packing_qty").notNull().default(0),
  tciBoraQty: integer("tci_bora_qty").notNull().default(0),
  normalBoraQty: integer("normal_bora_qty").notNull().default(0),
  status: text("status").notNull().default("Pending"),
  readyQuantity: numeric("ready_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  dispatchedQuantity: numeric("dispatched_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  gramage: text("gramage"),
  batchNumber: text("batch_number"),
  dispatchStatus: text("dispatch_status").notNull().default("Pending"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
