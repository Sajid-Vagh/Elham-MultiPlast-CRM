import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  title: text("title"),
  stage: text("stage").notNull().default("New"),
  probability: integer("probability").notNull().default(10),
  totalValue: numeric("total_value", { precision: 14, scale: 2 }),
  wonAmount: numeric("won_amount", { precision: 14, scale: 2 }),
  lostReason: text("lost_reason"),
  otherReason: text("other_reason"),
  lostNotes: text("lost_notes"),
  notes: text("notes"),
  salesOwnerId: integer("sales_owner_id").references(() => usersTable.id),
  category: text("category").notNull().default("Category A"),
  convertedToClient: boolean("converted_to_client").default(false),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const DEAL_STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"] as const;
export type DealStageName = typeof DEAL_STAGES[number];

export const STAGE_PROBS: Record<string, number> = {
  "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60,
  "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0,
};

export const insertDealSchema = createInsertSchema(dealsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
