import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";
import { dealsTable } from "./deals";
import { proformaInvoicesTable } from "./proforma_invoices";

export const DOCUMENT_TYPES = [
  "Visiting Card",
  "GST Certificate",
  "PAN Card",
  "Aadhaar",
  "Company Registration",
  "Purchase Order",
  "Quotation",
  "Proforma Invoice PDF",
  "Product Image",
  "Customer Image",
  "Payment Receipt",
  "Signed Agreement",
  "Product Specification",
  "Catalogue",
  "Excel File",
  "Word File",
  "PDF File",
  "ZIP File",
  "Other",
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const DOCUMENT_CATEGORIES = [
  "Customer Documents",
  "GST",
  "PAN",
  "Quotation",
  "Purchase Order",
  "Proforma Invoice",
  "Images",
  "Payment Proof",
  "Other Files",
] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  proformaInvoiceId: integer("proforma_invoice_id").references(() => proformaInvoicesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  originalName: text("original_name").notNull(),
  documentType: text("document_type").notNull().default("Other"),
  category: text("category").notNull().default("Customer Documents"),
  mimeType: text("mime_type"),
  fileExtension: text("file_extension"),
  fileSize: numeric("file_size", { precision: 14, scale: 2 }),
  storagePath: text("storage_path").notNull(),
  storageProvider: text("storage_provider").notNull().default("local"),
  thumbnailPath: text("thumbnail_path"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("Active"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  uploadedBy: integer("uploaded_by").notNull().references(() => usersTable.id),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const documentVersionsTable = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: numeric("file_size", { precision: 14, scale: 2 }),
  mimeType: text("mime_type"),
  storagePath: text("storage_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  uploadedBy: integer("uploaded_by").notNull().references(() => usersTable.id),
  action: text("action").notNull().default("upload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentVersionSchema = createInsertSchema(documentVersionsTable).omit({ id: true, createdAt: true });

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type DocumentVersion = typeof documentVersionsTable.$inferSelect;
