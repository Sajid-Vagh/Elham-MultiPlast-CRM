import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { proformaInvoicesTable } from "./proforma_invoices";
import { usersTable } from "./users";
import { dealsTable } from "./deals";

export const PRODUCTION_STATUSES = [
  "Pending",
  "Accepted",
  "Planning",
  "Machine Running",
  "Quality Check",
  "Ready For Dispatch",
  "Completed",
  "Cancelled",
] as const;

export type ProductionStatus = typeof PRODUCTION_STATUSES[number];

export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  "Pending": ["Accepted", "Cancelled"],
  "Accepted": ["Planning", "Cancelled"],
  "Planning": ["Machine Running", "Cancelled"],
  "Machine Running": ["Quality Check", "Cancelled"],
  "Quality Check": ["Ready For Dispatch", "Machine Running", "Cancelled"],
  "Ready For Dispatch": ["Completed"],
  "Completed": [],
  "Cancelled": [],
};

export const NOTE_TYPES = [
  "general",
  "delay",
  "issue",
  "machine_problem",
  "material_shortage",
  "power_failure",
  "quality_issue",
  "operator_remark",
  "planning",
] as const;

export type NoteType = typeof NOTE_TYPES[number];

export const PRIORITY_LEVELS = ["Low", "Medium", "High", "Urgent"] as const;
export type PriorityLevel = typeof PRIORITY_LEVELS[number];

export const productionOrdersTable = pgTable("production_orders", {
  id: serial("id").primaryKey(),
  proformaInvoiceId: integer("proforma_invoice_id")
    .references(() => proformaInvoicesTable.id, { onDelete: "cascade" }),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Pending"),
  priority: text("priority").notNull().default("Medium"),
  expectedDispatchDate: text("expected_dispatch_date"),
  assignedProductionManagerId: integer("assigned_production_manager_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  productionUnit: text("production_unit"),
  productionRemarks: text("production_remarks"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdByRole: text("created_by_role"),
  transportName: text("transport_name"),
  transportDetails: text("transport_details"),
  builtyUrl: text("builty_url"),
  dispatchCompletedAt: timestamp("dispatch_completed_at", { withTimezone: true }),
  dispatchCompletedBy: integer("dispatch_completed_by").references(() => usersTable.id, { onDelete: "set null" }),
  acceptedById: integer("accepted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  plannedMachine: text("planned_machine"),
  expectedStartDate: text("expected_start_date"),
  expectedCompletionDate: text("expected_completion_date"),
  startedById: integer("started_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  isFrozen: boolean("is_frozen").notNull().default(false),
  piVersionAtCreation: integer("pi_version_at_creation"),
  requestedUnit: text("requested_unit"),
  previousProductionUnit: text("previous_production_unit"),
  isDelayed: boolean("is_delayed").notNull().default(false),
  delayedAt: timestamp("delayed_at", { withTimezone: true }),
  delayReason: text("delay_reason"),
  cancelledById: integer("cancelled_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productionTimelineTable = pgTable("production_timeline", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productionNotesTable = pgTable("production_notes", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  note: text("note").notNull(),
  noteType: text("note_type").notNull().default("general"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productionTransferHistoryTable = pgTable("production_transfer_history", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  fromUnit: text("from_unit").notNull(),
  toUnit: text("to_unit").notNull(),
  transferredById: integer("transferred_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productionAuditTrailTable = pgTable("production_audit_trail", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  oldUnit: text("old_unit"),
  newUnit: text("new_unit"),
  oldQuantity: text("old_quantity"),
  newQuantity: text("new_quantity"),
  changedById: integer("changed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionOrderSchema = createInsertSchema(productionOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type ProductionOrder = typeof productionOrdersTable.$inferSelect;

export const insertProductionTimelineSchema = createInsertSchema(productionTimelineTable).omit({ id: true, createdAt: true });
export type InsertProductionTimeline = z.infer<typeof insertProductionTimelineSchema>;
export type ProductionTimeline = typeof productionTimelineTable.$inferSelect;

export const insertProductionNoteSchema = createInsertSchema(productionNotesTable).omit({ id: true, createdAt: true });
export type InsertProductionNote = z.infer<typeof insertProductionNoteSchema>;
export type ProductionNote = typeof productionNotesTable.$inferSelect;

export const insertProductionTransferHistorySchema = createInsertSchema(productionTransferHistoryTable).omit({ id: true, createdAt: true });
export type InsertProductionTransferHistory = z.infer<typeof insertProductionTransferHistorySchema>;
export type ProductionTransferHistory = typeof productionTransferHistoryTable.$inferSelect;

export const insertProductionAuditTrailSchema = createInsertSchema(productionAuditTrailTable).omit({ id: true, createdAt: true });
export type InsertProductionAuditTrail = z.infer<typeof insertProductionAuditTrailSchema>;
export type ProductionAuditTrail = typeof productionAuditTrailTable.$inferSelect;

export const productionMessagesTable = pgTable("production_messages", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  senderId: integer("sender_id").references(() => usersTable.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  senderRole: text("sender_role").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionMessageSchema = createInsertSchema(productionMessagesTable).omit({ id: true, createdAt: true });
export type InsertProductionMessage = z.infer<typeof insertProductionMessageSchema>;
export type ProductionMessage = typeof productionMessagesTable.$inferSelect;
