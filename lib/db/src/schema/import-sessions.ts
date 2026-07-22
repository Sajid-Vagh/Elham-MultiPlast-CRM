import { pgTable, text, serial, timestamp, integer, jsonb, numeric, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const importSessionsTable = pgTable("import_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  source: text("source").notNull().default("indiamart"),
  rawText: text("raw_text"),
  parserVersion: text("parser_version").notNull().default("v1"),
  parsedData: jsonb("parsed_data"),
  editedData: jsonb("edited_data"),
  finalData: jsonb("final_data"),
  confidence: jsonb("confidence"),
  overallConfidence: numeric("overall_confidence", { precision: 5, scale: 2 }),
  duplicateDetected: boolean("duplicate_detected").default(false),
  duplicateContactId: integer("duplicate_contact_id"),
  duplicateAction: text("duplicate_action"),
  resultLeadId: integer("result_lead_id"),
  result: text("result"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importCorrectionsTable = pgTable("import_corrections", {
  id: serial("id").primaryKey(),
  field: text("field").notNull(),
  originalValue: text("original_value"),
  correctedValue: text("corrected_value"),
  sourcePattern: text("source_pattern"),
  hitCount: integer("hit_count").notNull().default(1),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
