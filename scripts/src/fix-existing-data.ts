import { db, pool, contactsTable, ordersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

async function main() {
  console.log("🚀 Starting Data Backfill Process...");

  try {
    // ==========================================
    // 1. FIX CONTACTS (Customer Code: EML_1, EML_2)
    // ==========================================
    console.log("⏳ Fetching all contacts...");
    const allContacts = await db.select().from(contactsTable).orderBy(asc(contactsTable.createdAt));

    console.log(`Found ${allContacts.length} contacts. Updating customer codes...`);
    let contactCounter = 1;

    for (const contact of allContacts) {
      const code = `EML_${contactCounter}`;
      await db.update(contactsTable)
        .set({ customerCode: code })
        .where(eq(contactsTable.id, contact.id));

      console.log(`   -> Updated Contact ID ${contact.id} with ${code}`);
      contactCounter++;
    }
    console.log("✅ Contacts updated successfully!\n");

    // ==========================================
    // 2. FIX ORDERS (Order No: EML_2627_1)
    // ==========================================
    console.log("⏳ Fetching all orders...");
    const allOrders = await db.select().from(ordersTable).orderBy(asc(ordersTable.createdAt));

    console.log(`Found ${allOrders.length} orders. Updating order numbers...`);
    const fyCounters: Record<string, number> = {};

    for (const order of allOrders) {
      const date = new Date(order.createdAt || Date.now());
      const month = date.getMonth() + 1;
      const year = date.getFullYear();

      let fyStartYear = year;
      if (month < 4) {
        fyStartYear = year - 1;
      }

      const fyString = `${String(fyStartYear).slice(-2)}${String(fyStartYear + 1).slice(-2)}`;

      if (!fyCounters[fyString]) {
        fyCounters[fyString] = 1;
      }

      const newOrderNo = `EML_${fyString}_${fyCounters[fyString]}`;

      await db.update(ordersTable)
        .set({ orderNumber: newOrderNo })
        .where(eq(ordersTable.id, order.id));

      console.log(`   -> Updated Order ID ${order.id} (Old: ${order.orderNumber}) to ${newOrderNo}`);

      fyCounters[fyString]++;
    }
    console.log("✅ Orders updated successfully!");

  } catch (error) {
    console.error("❌ Error during backfill:", error);
  } finally {
    await pool.end();
    console.log("🏁 Process finished.");
  }
}

main();
