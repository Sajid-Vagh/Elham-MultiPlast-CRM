import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ID_PREFIXES = {
  customer: "CUS",
  lead: "LEAD",
  quotation: "QT",
  order: "ORD",
  batch: "BAT",
  dispatch: "DSP",
  complaint: "CMP",
  revision: "REV",
} as const;
export type IdPrefix = keyof typeof ID_PREFIXES;

export const idCountersTable = pgTable("id_counters", {
  id: serial("id").primaryKey(),
  prefix: text("prefix").notNull().unique(),
  counter: integer("counter").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIdCounterSchema = createInsertSchema(idCountersTable).omit({ id: true, updatedAt: true });
export type InsertIdCounter = z.infer<typeof insertIdCounterSchema>;
export type IdCounter = typeof idCountersTable.$inferSelect;
