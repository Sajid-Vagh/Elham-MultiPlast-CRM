import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importBatchesTable = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  importedBy: integer("imported_by"),
  fileName: text("file_name"),
  rowCount: integer("row_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  report: jsonb("report"),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  undoneBy: integer("undone_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportBatchSchema = createInsertSchema(importBatchesTable).omit({ id: true, createdAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
