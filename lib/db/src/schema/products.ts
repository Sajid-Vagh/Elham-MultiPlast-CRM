import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  pricePerUnit: numeric("price_per_unit", { precision: 12, scale: 2 }),
  productCode: text("product_code").notNull().unique(),
  bottleWeight: text("bottle_weight"),
  bottleColour: text("bottle_colour"),
  capColour: text("cap_colour"),
  materialType: text("material_type"),
  hsnCode: text("hsn_code"),
  defaultUnit: text("default_unit"),
  defaultGst: numeric("default_gst", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
