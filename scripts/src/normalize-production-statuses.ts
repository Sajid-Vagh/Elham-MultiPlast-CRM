import { db, pool, productionOrderItemsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

async function main() {
  console.log("Normalising productionStatus in production_order_items...\n");

  const all = await db.select().from(productionOrderItemsTable);
  console.log(`Total product line items: ${all.length}`);

  const pendingKeywords = ["Pend", "Conf", "Pending Verification", "Production Pending", "Confirmed"];
  const inProdKeywords = ["In Production", "Production On Going", "Production Started", "Production Running", "In Prod"];
  const readyKeywords = ["Ready", "Complete"];

  const toPending: number[] = [];
  const toInProduction: number[] = [];
  const toReady: number[] = [];
  const skipped: string[] = [];

  for (const item of all) {
    const s = (item.productionStatus || "").trim();
    const lower = s.toLowerCase();

    if (["pending", "in production", "ready"].includes(lower)) {
      skipped.push(`${item.id}: already "${s}"`);
      continue;
    }

    if (pendingKeywords.some(k => lower.includes(k.toLowerCase())) || s === "Confirmed") {
      toPending.push(item.id);
    } else if (inProdKeywords.some(k => lower.includes(k.toLowerCase())) || s === "Production Running") {
      toInProduction.push(item.id);
    } else if (readyKeywords.some(k => lower.includes(k.toLowerCase())) || s === "Completed") {
      toReady.push(item.id);
    } else {
      skipped.push(`${item.id}: "${s}" → unmatched, defaulting to Pending`);
      toPending.push(item.id);
    }
  }

  if (toPending.length > 0) {
    await db.update(productionOrderItemsTable).set({ productionStatus: "Pending" }).where(inArray(productionOrderItemsTable.id, toPending));
    console.log(`  → Set ${toPending.length} items to "Pending"`);
  }
  if (toInProduction.length > 0) {
    await db.update(productionOrderItemsTable).set({ productionStatus: "In Production" }).where(inArray(productionOrderItemsTable.id, toInProduction));
    console.log(`  → Set ${toInProduction.length} items to "In Production"`);
  }
  if (toReady.length > 0) {
    await db.update(productionOrderItemsTable).set({ productionStatus: "Ready" }).where(inArray(productionOrderItemsTable.id, toReady));
    console.log(`  → Set ${toReady.length} items to "Ready"`);
  }

  console.log(`\nSkipped (already correct): ${skipped.length}`);
  for (const msg of skipped) console.log(`  ${msg}`);

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
