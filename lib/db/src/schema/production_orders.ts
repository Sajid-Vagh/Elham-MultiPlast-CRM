import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { proformaInvoicesTable } from "./proforma_invoices";
import { usersTable } from "./users";

export const PRODUCTION_STATUSES = [
  "Pending",
  "Material Ready",
  "Production Started",
  "In Process",
  "Quality Check",
  "Packing",
  "Ready For Dispatch",
  "Completed",
  "On Hold",
  "Cancelled",
] as const;

export type ProductionStatus = typeof PRODUCTION_STATUSES[number];

export const PRIORITY_LEVELS = ["Low", "Medium", "High", "Urgent"] as const;
export type PriorityLevel = typeof PRIORITY_LEVELS[number];

export const productionOrdersTable = pgTable("production_orders", {
  id: serial("id").primaryKey(),
  proformaInvoiceId: integer("proforma_invoice_id")
    .references(() => proformaInvoicesTable.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
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
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
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
