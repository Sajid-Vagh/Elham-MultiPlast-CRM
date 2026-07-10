import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { productsTable } from "./products";

export const QUOTATION_STATUSES = [
  "Draft",
  "Sent",
  "Viewed",
  "Negotiation",
  "Approved",
  "Rejected",
  "Expired",
  "Converted to Order",
] as const;
export type QuotationStatus = typeof QUOTATION_STATUSES[number];

export const quotationsTable = pgTable("quotations", {
  id: serial("id").primaryKey(),
  quotationNumber: text("quotation_number").notNull().unique(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "restrict" }),
  customerName: text("customer_name").notNull(),
  companyName: text("company_name"),
  mobile: text("mobile"),
  email: text("email"),
  gstNumber: text("gst_number"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  status: text("status").notNull().default("Draft"),
  salesOwnerId: integer("sales_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalGst: numeric("total_gst", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  freight: numeric("freight", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentTerms: text("payment_terms"),
  deliveryTerms: text("delivery_terms"),
  validityDays: integer("validity_days").default(15),
  remarks: text("notes"),
  convertedOrderId: integer("converted_order_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotationItemsTable = pgTable("quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id").notNull().references(() => quotationsTable.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuotation = z.infer<typeof insertQuotationSchema>;
export type Quotation = typeof quotationsTable.$inferSelect;

export const insertQuotationItemSchema = createInsertSchema(quotationItemsTable).omit({ id: true, createdAt: true });
export type InsertQuotationItem = z.infer<typeof insertQuotationItemSchema>;
export type QuotationItem = typeof quotationItemsTable.$inferSelect;
