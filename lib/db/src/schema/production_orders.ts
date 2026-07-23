import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { proformaInvoicesTable } from "./proforma_invoices";
import { usersTable } from "./users";
import { dealsTable } from "./deals";

export const PRODUCTION_STATUSES = [
  "Pending",
  "Production On Going",
  "Packaging",
  "Ready To Dispatch",
  "Completed",
  "Cancelled",
] as const;

export type ProductionStatus = typeof PRODUCTION_STATUSES[number];

export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  "Pending": ["Production On Going", "Cancelled"],
  "Production On Going": ["Packaging", "Cancelled"],
  "Packaging": ["Ready To Dispatch", "Cancelled"],
  "Ready To Dispatch": [],
  "Completed": [],
  "Cancelled": [],
};

export const PRODUCTION_DISPATCH_STATUSES = [
  "Pending Dispatch",
  "Load Vehicle",
  "Dispatch",
  "Delivered",
] as const;

export type ProductionDispatchStatus = typeof PRODUCTION_DISPATCH_STATUSES[number];

export const VALID_DISPATCH_TRANSITIONS: Record<string, string[]> = {
  "Pending Dispatch": ["Load Vehicle"],
  "Load Vehicle": ["Dispatch"],
  "Dispatch": ["Delivered"],
  "Delivered": [],
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

export const PACKING_TYPES = ["Bundle", "Packet"] as const;
export type PackingType = typeof PACKING_TYPES[number];

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
  // New v2 columns
  productionMachine: text("production_machine"),
  operatorName: text("operator_name"),
  inProductionNotes: text("in_production_notes"),
  packingType: text("packing_type"),
  packingNotes: text("packing_notes"),
  packingCompletedById: integer("packing_completed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  packingCompletedAt: timestamp("packing_completed_at", { withTimezone: true }),
  transportBookedById: integer("transport_booked_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  transportBookedAt: timestamp("transport_booked_at", { withTimezone: true }),
  // Dispatch workflow columns
  dispatchStatus: text("dispatch_status"),
  lrNumber: text("lr_number"),
  dispatchRemarks: text("dispatch_remarks"),
  dispatchedById: integer("dispatched_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  deliveryDate: text("delivery_date"),
  deliveredById: integer("delivered_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
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
