import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface InventoryFormatting {
  isBold?: boolean;
  highlightColor?: string;
  textColor?: string;
}

export const inventoryTable = pgTable("inventory", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  unitName: text("unit_name").notNull(),
  size: text("size"),
  bottleColor: text("bottle_color"),
  weight: text("weight"),
  stock: integer("stock").notNull().default(0),
  clientOrder: integer("client_order").notNull().default(0),
  sortOrder: integer("sort_order"),
  formatting: jsonb("formatting").$type<InventoryFormatting>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_inventory_product_name").on(t.productName),
  index("idx_inventory_unit_name").on(t.unitName),
  index("idx_inventory_sort_order").on(t.sortOrder),
]);

export const inventoryLogsTable = pgTable("inventory_logs", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  unitName: text("unit_name").notNull(),
  adjustmentType: text("adjustment_type").notNull(),
  quantity: integer("quantity").notNull(),
  previousStock: integer("previous_stock").notNull(),
  newStock: integer("new_stock").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_inventory_logs_product_name").on(t.productName),
  index("idx_inventory_logs_unit_name").on(t.unitName),
  index("idx_inventory_logs_created_at").on(t.createdAt),
]);

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;

export const insertInventoryLogSchema = createInsertSchema(inventoryLogsTable).omit({ id: true, createdAt: true });
export type InsertInventoryLog = z.infer<typeof insertInventoryLogSchema>;
export type InventoryLog = typeof inventoryLogsTable.$inferSelect;
