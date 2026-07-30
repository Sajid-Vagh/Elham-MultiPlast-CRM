import { db, pool, contactsTable, ordersTable, productionOrdersTable } from "@workspace/db";
import { asc, isNull, sql } from "drizzle-orm";

const CHUNK_SIZE = 50;

function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 3) {
    const y1 = year % 100;
    const y2 = (year + 1) % 100;
    return `${String(y1).padStart(2, "0")}${String(y2).padStart(2, "0")}`;
  } else {
    const y1 = (year - 1) % 100;
    const y2 = year % 100;
    return `${String(y1).padStart(2, "0")}${String(y2).padStart(2, "0")}`;
  }
}

async function backfillCustomerCodes(): Promise<number> {
  console.log("\n=== Backfilling customer_code for contacts ===");

  const contacts = await db
    .select({ id: contactsTable.id, createdAt: contactsTable.createdAt })
    .from(contactsTable)
    .where(isNull(contactsTable.customerCode))
    .orderBy(asc(contactsTable.createdAt));

  if (contacts.length === 0) {
    console.log("  No contacts need backfilling (all have customer_code already).");
    return 0;
  }

  console.log(`  Found ${contacts.length} contacts without customer_code.`);

  let counter = 1;
  for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
    const chunk = contacts.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((contact) => {
        const code = `EML_${counter++}`;
        return db
          .update(contactsTable)
          .set({ customerCode: code })
          .where(sql`${contactsTable.id} = ${contact.id}`);
      })
    );
    const last = Math.min(i + CHUNK_SIZE, contacts.length);
    console.log(`  ✓ Updated contacts ${i + 1}–${last} of ${contacts.length}`);
  }

  console.log(`  ✅ Successfully backfilled ${contacts.length} contacts with customer_code.`);
  return contacts.length;
}

async function backfillFormattedOrderIds(): Promise<number> {
  console.log("\n=== Backfilling formatted_order_id for orders ===");

  const orders = await db
    .select({ id: ordersTable.id, createdAt: ordersTable.createdAt })
    .from(ordersTable)
    .where(isNull(ordersTable.formattedOrderId))
    .orderBy(asc(ordersTable.createdAt));

  if (orders.length === 0) {
    console.log("  No orders need backfilling (all have formatted_order_id already).");
    return 0;
  }

  console.log(`  Found ${orders.length} orders without formatted_order_id.`);

  const counters: Record<string, number> = {};
  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((order) => {
        const fallback = order.createdAt ?? new Date("2024-01-01");
        const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(fallback);
        const fy = getFinancialYear(createdAt);
        counters[fy] = (counters[fy] ?? 0) + 1;
        const seq = counters[fy];
        const orderId = `EML_${fy}_${seq}`;
        return db
          .update(ordersTable)
          .set({ formattedOrderId: orderId })
          .where(sql`${ordersTable.id} = ${order.id}`);
      })
    );
    const last = Math.min(i + CHUNK_SIZE, orders.length);
    console.log(`  ✓ Updated orders ${i + 1}–${last} of ${orders.length}`);
  }

  console.log(`  ✅ Successfully backfilled ${orders.length} orders with formatted_order_id.`);
  return orders.length;
}

async function backfillProductionOrderIds(): Promise<number> {
  console.log("\n=== Backfilling formatted_order_id for production_orders ===");

  const prodOrders = await db
    .select({ id: productionOrdersTable.id, createdAt: productionOrdersTable.createdAt })
    .from(productionOrdersTable)
    .where(isNull(productionOrdersTable.formattedOrderId))
    .orderBy(asc(productionOrdersTable.createdAt));

  if (prodOrders.length === 0) {
    console.log("  No production_orders need backfilling (all have formatted_order_id already).");
    return 0;
  }

  console.log(`  Found ${prodOrders.length} production_orders without formatted_order_id.`);

  const counters: Record<string, number> = {};
  for (let i = 0; i < prodOrders.length; i += CHUNK_SIZE) {
    const chunk = prodOrders.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((po) => {
        const fallback = po.createdAt ?? new Date("2024-01-01");
        const createdAt = po.createdAt instanceof Date ? po.createdAt : new Date(fallback);
        const fy = getFinancialYear(createdAt);
        counters[fy] = (counters[fy] ?? 0) + 1;
        const seq = counters[fy];
        const orderId = `EML_${fy}_${seq}`;
        return db
          .update(productionOrdersTable)
          .set({ formattedOrderId: orderId })
          .where(sql`${productionOrdersTable.id} = ${po.id}`);
      })
    );
    const last = Math.min(i + CHUNK_SIZE, prodOrders.length);
    console.log(`  ✓ Updated production_orders ${i + 1}–${last} of ${prodOrders.length}`);
  }

  console.log(`  ✅ Successfully backfilled ${prodOrders.length} production_orders with formatted_order_id.`);
  return prodOrders.length;
}

async function main() {
  console.log("Starting backfill script...\n");

  const contactCount = await backfillCustomerCodes();
  const orderCount = await backfillFormattedOrderIds();
  const prodOrderCount = await backfillProductionOrderIds();

  const total = contactCount + orderCount + prodOrderCount;
  console.log(`\n========================================`);
  console.log(`  Backfill complete! Total records updated: ${total}`);
  console.log(`    • Contacts:         ${contactCount}`);
  console.log(`    • Orders:           ${orderCount}`);
  console.log(`    • Production Orders: ${prodOrderCount}`);
  console.log(`========================================\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
