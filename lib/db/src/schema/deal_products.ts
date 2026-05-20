import { pgTable, serial, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealsTable } from "./deals";
import { productsTable } from "./products";

export const dealProductsTable = pgTable("deal_products", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
});

export const insertDealProductSchema = createInsertSchema(dealProductsTable).omit({ id: true });
export type InsertDealProduct = z.infer<typeof insertDealProductSchema>;
export type DealProduct = typeof dealProductsTable.$inferSelect;
