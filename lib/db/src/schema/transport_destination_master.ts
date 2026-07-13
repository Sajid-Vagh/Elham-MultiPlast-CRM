import { pgTable, text, serial, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const TRANSPORT_TYPES = ["Bundle Wise", "Vehicle Wise"] as const;
export type TransportType = typeof TRANSPORT_TYPES[number];

export const transportDestinationMasterTable = pgTable("transport_destination_master", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  city: text("city").notNull(),
  transportType: text("transport_type").notNull().default("Bundle Wise"),
  transportCharge: numeric("transport_charge", { precision: 12, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransportDestinationMasterSchema = createInsertSchema(transportDestinationMasterTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransportDestinationMaster = z.infer<typeof insertTransportDestinationMasterSchema>;
export type TransportDestinationMaster = typeof transportDestinationMasterTable.$inferSelect;
