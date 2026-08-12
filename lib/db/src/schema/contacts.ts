import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const CATEGORIES = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client"] as const;
export type ContactCategory = typeof CATEGORIES[number];

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mobile: text("mobile").notNull().unique(),
  email: text("email").unique(),
  companyName: text("company_name"),
  salesOwnerId: integer("sales_owner_id").notNull().references(() => usersTable.id),
  otherPhone: text("other_phone"),
  otherEmail: text("other_email"),
  leadSource: text("lead_source"),
  city: text("city"),
  state: text("state"),
  address: text("address"),
  unit: text("unit"),
  industry: text("industry"),
  tags: text("tags"),
  inquiryDate: text("inquiry_date"),
  lastCallDate: text("last_call_date"),
  nextCallDate: text("next_call_date"),
  category: text("category").notNull().default("Regular Follow up"),
  customerSince: text("customer_since"),
  totalOrders: integer("total_orders").default(0),
  totalRevenue: numeric("total_revenue", { precision: 14, scale: 2 }),
  lastPurchaseDate: text("last_purchase_date"),
  customerStatus: text("customer_status").default("Active"),
  customerComments: text("customer_comments"),
  commentUpdatedAt: timestamp("comment_updated_at", { withTimezone: true }),
  commentUpdatedBy: integer("comment_updated_by").references(() => usersTable.id),
  isMyClient: boolean("is_my_client").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  isRepeatEnquiry: boolean("is_repeat_enquiry").notNull().default(false),
  // Per-user read tracking: array of user IDs who have read/acknowledged this
  // lead. The read/unread indicator is computed per-request from this array
  // (isRead = readBy includes the requesting user), replacing the global is_read flag.
  readBy: integer("read_by").array().notNull().default([]),
  lostReason: text("lost_reason"),
  otherReason: text("other_reason"),
  lostNotes: text("lost_notes"),
  lostDate: timestamp("lost_date", { withTimezone: true }),
  customerCode: text("customer_code").unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
