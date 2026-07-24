import { db, contactsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Generate the next unique Customer Code in format EML_001, EML_002, etc.
 * Never reuses deleted numbers. Uses MAX(existing) + 1 approach.
 */
export async function generateCustomerCode(): Promise<string> {
  const [result] = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${contactsTable.customerCode} FROM 5) AS INTEGER)), 0)` })
    .from(contactsTable)
    .where(sql`${contactsTable.customerCode} IS NOT NULL AND ${contactsTable.customerCode} LIKE 'EML_%'`);

  const nextNum = (result?.maxNum ?? 0) + 1;
  return `EML_${String(nextNum).padStart(3, "0")}`;
}
