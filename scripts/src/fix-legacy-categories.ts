import { db, pool, contactsTable, dealsTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";

async function main() {
  console.log("[FIX] Starting legacy category cleanup...");

  // 1. Find all distinct contacts that have at least one Won deal
  const wonDealContacts = await db
    .selectDistinct({ contactId: dealsTable.contactId })
    .from(dealsTable)
    .where(eq(dealsTable.stage, "Won"));

  const contactIds = wonDealContacts.map((r) => r.contactId);
  console.log(`[FIX] Found ${contactIds.length} distinct contact(s) with a Won deal.`);

  if (contactIds.length === 0) {
    console.log("[FIX] Nothing to fix — no contacts with Won deals found.");
    return;
  }

  // 2. Of those, only pick contacts whose category is NOT already "My Client"
  const staleContacts = await db
    .select({ id: contactsTable.id, name: contactsTable.name, category: contactsTable.category })
    .from(contactsTable)
    .where(and(
      inArray(contactsTable.id, contactIds),
      ne(contactsTable.category, "My Client"),
    ));

  console.log(`[FIX] ${staleContacts.length} of them still have a non-"My Client" category and need updating.`);
  if (staleContacts.length > 0) {
    console.log("[FIX] Affected contacts:");
    for (const c of staleContacts) {
      console.log(`       - #${c.id} ${c.name ?? "(no name)"}: "${c.category}"`);
    }
  }

  if (staleContacts.length === 0) {
    console.log("[FIX] All contacts with Won deals are already in 'My Client'. Nothing to update.");
    return;
  }

  const staleIds = staleContacts.map((c) => c.id);

  // 3. Update their category to "My Client" (safeguard repeated for safety)
  const result = await db
    .update(contactsTable)
    .set({ category: "My Client" })
    .where(and(
      inArray(contactsTable.id, staleIds),
      ne(contactsTable.category, "My Client"),
    ));

  const updatedCount = result.rowCount ?? 0;
  console.log(`[FIX] Successfully updated ${updatedCount} contact(s) to category "My Client".`);
  console.log("[FIX] Done.");
}

main()
  .catch((err) => {
    console.error("[FIX] Error during cleanup:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    console.log("[FIX] Process finished.");
  });
