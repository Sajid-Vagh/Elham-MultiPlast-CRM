import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealsTable } from "./deals";
import { proformaInvoicesTable } from "./proforma_invoices";
import { productionOrdersTable } from "./production_orders";
import { usersTable } from "./users";

export const voiceNotesTable = pgTable("voice_notes", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  proformaInvoiceId: integer("proforma_invoice_id").references(() => proformaInvoicesTable.id, { onDelete: "set null" }),
  productionOrderId: integer("production_order_id").references(() => productionOrdersTable.id, { onDelete: "set null" }),
  uploadedById: integer("uploaded_by_id").notNull().references(() => usersTable.id),
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
});
export type InsertVoiceNote = z.infer<typeof insertVoiceNoteSchema>;
export type VoiceNote = typeof voiceNotesTable.$inferSelect;
