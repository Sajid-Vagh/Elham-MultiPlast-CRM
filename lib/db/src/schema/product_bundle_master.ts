import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productBundleMasterTable = pgTable("product_bundle_master", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  productId: integer("product_id"),
  bundleSize: integer("bundle_size").notNull().default(80),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductBundleMasterSchema = createInsertSchema(productBundleMasterTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductBundleMaster = z.infer<typeof insertProductBundleMasterSchema>;
export type ProductBundleMaster = typeof productBundleMasterTable.$inferSelect;
