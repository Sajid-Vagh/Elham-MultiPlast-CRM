import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";

export const customerMasterTable = pgTable("customer_master", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  tradeName: text("trade_name"),
  contactPerson: text("contact_person"),
  gstin: text("gstin").unique(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressLine3: text("address_line3"),
  city: text("city"),
  district: text("district"),
  state: text("state"),
  pincode: text("pincode"),
  mobile: text("mobile"),
  email: text("email"),
  customerType: text("customer_type").default("GST"),
  gstStatus: text("gst_status").default("Active"),
  businessConstitution: text("business_constitution"),
  notes: text("notes"),
  linkedContactId: integer("linked_contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerMasterSchema = createInsertSchema(customerMasterTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCustomerMaster = z.infer<typeof insertCustomerMasterSchema>;
export type CustomerMaster = typeof customerMasterTable.$inferSelect;
