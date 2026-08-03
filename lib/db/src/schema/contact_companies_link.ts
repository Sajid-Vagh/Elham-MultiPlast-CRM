import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { customerMasterTable } from "./customer_master";
import { usersTable } from "./users";

// Junction table implementing the Many-to-Many relationship between Contacts
// (phone numbers) and Company/GST profiles (customer_master).
//
// - One contact can be linked to many Company/GST profiles.
// - One Company/GST profile can be linked to many contacts (e.g. Person A and
//   Person B both work for 'Company X' and share the same GST details).
//
// The customer_master row stays the single source of truth for the company's
// GST data — linking a contact only adds a row here, it never duplicates.
export const contactCompaniesLinkTable = pgTable("contact_companies_link", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => customerMasterTable.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactCompaniesLinkSchema = createInsertSchema(contactCompaniesLinkTable).omit({ id: true, createdAt: true });

export type InsertContactCompaniesLink = z.infer<typeof insertContactCompaniesLinkSchema>;
export type ContactCompaniesLink = typeof contactCompaniesLinkTable.$inferSelect;
