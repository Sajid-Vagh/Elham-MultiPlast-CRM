import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const BATCH_STATUSES = [
  "Planned",
  "Material Issued",
  "Running",
  "Paused",
  "Completed",
  "QC Pending",
  "QC Passed",
  "QC Failed",
  "Ready For Dispatch",
  "Closed",
] as const;
export type BatchStatus = typeof BATCH_STATUSES[number];

export const productionBatchesTable = pgTable("production_batches", {
  id: serial("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  productName: text("product_name").notNull(),
  productCode: text("product_code"),
  totalQuantity: numeric("total_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: numeric("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  rejectedQuantity: numeric("rejected_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Planned"),
  priority: text("priority").notNull().default("Normal"),
  machine: text("machine"),
  machineCapacity: text("machine_capacity"),
  operator: text("operator"),
  shift: text("shift"),
  expectedCompletionDate: text("expected_completion_date"),
  actualCompletionDate: text("actual_completion_date"),
  progress: integer("progress").notNull().default(0),
  ordersIncluded: jsonb("orders_included").default([]),
  assignedProductionManagerId: integer("assigned_production_manager_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productionBatchItemsTable = pgTable("production_batch_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => productionBatchesTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id"),
  orderId: integer("order_id"),
  productName: text("product_name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: numeric("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  rejectedQuantity: numeric("rejected_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qcReportsTable = pgTable("qc_reports", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => productionBatchesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("Pending"),
  qcPerson: text("qc_person"),
  qcDate: text("qc_date"),
  bottleWeight: text("bottle_weight"),
  colorCheck: text("color_check"),
  leakTest: text("leak_test"),
  capFitting: text("cap_fitting"),
  visualInspection: text("visual_inspection"),
  overallResult: text("overall_result"),
  remarks: text("remarks"),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionBatchSchema = createInsertSchema(productionBatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductionBatch = z.infer<typeof insertProductionBatchSchema>;
export type ProductionBatch = typeof productionBatchesTable.$inferSelect;

export const insertProductionBatchItemSchema = createInsertSchema(productionBatchItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductionBatchItem = z.infer<typeof insertProductionBatchItemSchema>;
export type ProductionBatchItem = typeof productionBatchItemsTable.$inferSelect;

export const insertQcReportSchema = createInsertSchema(qcReportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQcReport = z.infer<typeof insertQcReportSchema>;
export type QcReport = typeof qcReportsTable.$inferSelect;
