import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transportLogisticsTable = pgTable("transport_logistics", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  destinationState: text("destination_state").notNull(),
  destinationCity: text("destination_city").notNull(),
  bundleSizeQty: integer("bundle_size_qty").notNull(),
  transportCostPerBundle: numeric("transport_cost_per_bundle", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransportLogisticsSchema = createInsertSchema(transportLogisticsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransportLogistics = z.infer<typeof insertTransportLogisticsSchema>;
export type TransportLogistics = typeof transportLogisticsTable.$inferSelect;
