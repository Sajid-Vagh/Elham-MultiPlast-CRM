import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";
import { dealsTable } from "./deals";
import { customerMasterTable } from "./customer_master";

export const INVOICE_STATUSES = ["Draft", "Sent", "Viewed", "Approved", "Rejected", "Expired", "Converted to Order", "Converted to Production"] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const proformaInvoicesTable = pgTable("proforma_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerName: text("customer_name").notNull(),
  companyName: text("company_name"),
  tradeName: text("trade_name"),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  salesOwnerId: integer("sales_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  address: text("address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressLine3: text("address_line3"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  district: text("district"),
  customerMasterId: integer("customer_master_id").references(() => customerMasterTable.id, { onDelete: "set null" }),
  customerType: text("customer_type").notNull().default("GST"),
  gstNumber: text("gst_number"),
  gstStatus: text("gst_status"),
  idProofType: text("id_proof_type"),
  idProofNumber: text("id_proof_number"),
  mobile: text("mobile").notNull().default(""),
  taxableAmount: numeric("taxable_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  freight: numeric("freight", { precision: 14, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 14, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 14, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 14, scale: 2 }).notNull().default("0"),
  cgstPercent: numeric("cgst_percent", { precision: 5, scale: 2 }).default("0"),
  sgstPercent: numeric("sgst_percent", { precision: 5, scale: 2 }).default("0"),
  igstPercent: numeric("igst_percent", { precision: 5, scale: 2 }).default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  amountInWords: text("amount_in_words"),
  status: text("status").notNull().default("Draft"),
  notes: text("notes"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const proformaInvoiceItemsTable = pgTable("proforma_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => proformaInvoicesTable.id, { onDelete: "cascade" }),
  productName: text("product_name").notNull(),
  hsnCode: text("hsn_code"),
  bottleType: text("bottle_type"),
  capacity: text("capacity"),
  weight: text("weight"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull().default("Pcs"),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).default("0"),
  gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }).default("0"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
});

export const proformaInvoiceHistoryTable = pgTable("proforma_invoice_history", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => proformaInvoicesTable.id, { onDelete: "cascade" }),
  statusFrom: text("status_from"),
  statusTo: text("status_to").notNull(),
  changedBy: integer("changed_by").notNull().references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProformaInvoiceSchema = createInsertSchema(proformaInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProformaInvoiceItemSchema = createInsertSchema(proformaInvoiceItemsTable).omit({ id: true });
export const insertProformaInvoiceHistorySchema = createInsertSchema(proformaInvoiceHistoryTable).omit({ id: true, createdAt: true });

export type InsertProformaInvoice = z.infer<typeof insertProformaInvoiceSchema>;
export type ProformaInvoice = typeof proformaInvoicesTable.$inferSelect;
export type InsertProformaInvoiceItem = z.infer<typeof insertProformaInvoiceItemSchema>;
export type ProformaInvoiceItem = typeof proformaInvoiceItemsTable.$inferSelect;
export type ProformaInvoiceHistory = typeof proformaInvoiceHistoryTable.$inferSelect;
