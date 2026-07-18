import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const TRANSPORT_TYPES = ["Bundle Wise", "Vehicle Wise"] as const;
export type TransportType = typeof TRANSPORT_TYPES[number];

export const transportDestinationMasterTable = pgTable("transport_destination_master", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  city: text("city").notNull(),
  pinCode: text("pin_code"),
  transportCompany: text("transport_company"),
  transportType: text("transport_type").notNull().default("Bundle Wise"),
  transportCharge: numeric("transport_charge", { precision: 12, scale: 2 }).notNull().default("0"),
  transitDays: integer("transit_days"),
  productionUnit: text("production_unit"),
  remarks: text("remarks"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  importBatchId: integer("import_batch_id"),
  // future-ready columns (nullable, unused now)
  transportZone: text("transport_zone"),
  distanceKm: numeric("distance_km", { precision: 8, scale: 2 }),
  weightSlabMin: numeric("weight_slab_min", { precision: 8, scale: 2 }),
  weightSlabMax: numeric("weight_slab_max", { precision: 8, scale: 2 }),
  vehicleType: text("vehicle_type"),
  minFreight: numeric("min_freight", { precision: 12, scale: 2 }),
  maxFreight: numeric("max_freight", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransportDestinationMasterSchema = createInsertSchema(transportDestinationMasterTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransportDestinationMaster = z.infer<typeof insertTransportDestinationMasterSchema>;
export type TransportDestinationMaster = typeof transportDestinationMasterTable.$inferSelect;
