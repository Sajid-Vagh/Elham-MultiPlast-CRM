import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealsTable } from "./deals";
import { proformaInvoicesTable } from "./proforma_invoices";
import { productionOrdersTable } from "./production_orders";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { contactsTable } from "./contacts";
import { customerMasterTable } from "./customer_master";

export const voiceNotesTable = pgTable("voice_notes", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  proformaInvoiceId: integer("proforma_invoice_id").references(() => proformaInvoicesTable.id, { onDelete: "set null" }),
  productionOrderId: integer("production_order_id").references(() => productionOrdersTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => contactsTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customerMasterTable.id, { onDelete: "set null" }),
  uploadedById: integer("uploaded_by_id").notNull().references(() => usersTable.id),
  createdByRole: text("created_by_role").notNull().default("sales"),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storagePath: text("storage_path").notNull(),
  durationMs: integer("duration_ms"),
  transcript: text("transcript"),
  transcriptStatus: text("transcript_status").notNull().default("pending"),
  isReplaced: boolean("is_replaced").notNull().default(false),
  replacedById: integer("replaced_by_id"),
  fileAvailable: boolean("file_available").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedById: integer("deleted_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVoiceNoteSchema = createInsertSchema(voiceNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedById: true,
  fileAvailable: true,
});
export type InsertVoiceNote = z.infer<typeof insertVoiceNoteSchema>;
export type VoiceNote = typeof voiceNotesTable.$inferSelect;
