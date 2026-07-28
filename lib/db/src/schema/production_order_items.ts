import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productionOrdersTable } from "./production_orders";

export const PRODUCT_LINE_STATUSES = ["Pending", "In Production", "Ready"] as const;
export type ProductLineStatus = typeof PRODUCT_LINE_STATUSES[number];

export const VALID_PRODUCT_LINE_TRANSITIONS: Record<string, string[]> = {
  "Pending": ["In Production"],
  "In Production": ["Ready", "In Production"],
  "Ready": [],
};

export const productionOrderItemsTable = pgTable("production_order_items", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id")
    .references(() => productionOrdersTable.id, { onDelete: "cascade" })
    .notNull(),
  piItemId: integer("pi_item_id"),
  productName: text("product_name").notNull(),
  materialType: text("material_type"),
  machineType: text("machine_type"),
  bottleColour: text("bottle_colour"),
  bottleWeight: text("bottle_weight"),
  capColour: text("cap_colour"),
  capWeight: text("cap_weight"),
  neckSize: text("neck_size"),
  hsnCode: text("hsn_code"),
  orderedQuantity: numeric("ordered_quantity", { precision: 12, scale: 2 }).notNull(),
  readyQuantity: numeric("ready_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  productionStatus: text("production_status").notNull().default("Pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionOrderItemSchema = createInsertSchema(productionOrderItemsTable).omit({ id: true, updatedAt: true, startedAt: true, completedAt: true });
export type InsertProductionOrderItem = z.infer<typeof insertProductionOrderItemSchema>;
export type ProductionOrderItem = typeof productionOrderItemsTable.$inferSelect;
