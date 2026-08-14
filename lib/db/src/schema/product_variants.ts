import { pgTable, text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { productsTable } from "./products";

export const productVariantsTable = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "cascade" }),
  weight: text("weight"),
  defaultColor: text("default_color"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductVariant = typeof productVariantsTable.$inferSelect;
export type InsertProductVariant = typeof productVariantsTable.$inferInsert;
