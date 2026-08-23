import { db, contactsTable } from "@workspace/db";
import { like } from "drizzle-orm";

const UNKNOWN_NAME_RE = /^Unknown (\d+)$/;

// Generates the next sequential auto-name ("Unknown N") for leads created
// without a name, so every lead always has a clickable identity.
export async function generateUnknownName(): Promise<string> {
  const rows = await db.select({ name: contactsTable.name })
    .from(contactsTable)
    .where(like(contactsTable.name, "Unknown %"));
  let max = 0;
  for (const row of rows) {
    const match = UNKNOWN_NAME_RE.exec((row.name || "").trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `Unknown ${max + 1}`;
}
