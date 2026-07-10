import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const orderTimelineTable = pgTable("order_timeline", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id"),
  type: text("type").notNull(),
  description: text("description").notNull(),
  metadata: text("metadata"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderTimelineSchema = createInsertSchema(orderTimelineTable).omit({ id: true, createdAt: true });
export type InsertOrderTimeline = z.infer<typeof insertOrderTimelineSchema>;
export type OrderTimeline = typeof orderTimelineTable.$inferSelect;
