import { db, pool, productsTable, proformaInvoiceItemsTable, orderItemsTable, dealProductsTable, productVariantsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";

// Backfill flat legacy products into Master Products + Variants.
//
// The old model stored one row per product per weight/colour (e.g. three rows
// named "1L Lubricant" with bottle_weight 80/60/60). The new model keeps ONE
// master row per product family and stores weight/colour combinations in
// product_variants. Historical product_id references are repointed to the master.
//
// Rules:
//   - Group products by trim(lower(name)).
//   - Master = group member with a productCode (preferred) else the lowest id.
//   - Master keeps its cleaned name + status='active'; missing master attributes
//     (industry/machineType/materialType/hsnCode/defaultUnit/capColour/category)
//     are filled from any member that has them.
//   - Every other member is ARCHIVED (status='inactive') — never deleted.
//   - product_variants rows are created from every member's (weight, colour).
//   - proforma_invoice_items/order_items/deal_products.product_id pointing at an
//     archived member is repointed to the master; NULL product_id rows whose
//     product_name matches the group are linked to the master too (best effort).
//
// Run:      npm run backfill-product-variants             (dry run — no writes)
//           npm run backfill-product-variants -- --apply  (writes to the database)
//
// Env:      DATABASE_URL (loaded via --env-file ../.env)

const APPLY = process.argv.includes("--apply");

type ProductRow = typeof productsTable.$inferSelect;

const clean = (v: string | null | undefined) => (v == null ? null : String(v).trim());

async function ensureVariantsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_variants (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      weight TEXT,
      default_color TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("✓ product_variants table ready");
}

interface GroupPlan {
  key: string;
  baseName: string;
  master: ProductRow;
  archived: ProductRow[];
  fields: Partial<Record<"industry" | "machineType" | "materialType" | "hsnCode" | "defaultUnit" | "capColour" | "category", string | null>>;
  weights: { weight: string | null; defaultColor: string | null }[];
}

function buildPlan(products: ProductRow[]): GroupPlan[] {
  const groups = new Map<string, ProductRow[]>();
  for (const p of products) {
    const key = (p.name || "").toLowerCase().trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const plan: GroupPlan[] = [];
  for (const [key, members] of groups) {
    const sorted = [...members].sort((a, b) => {
      const ac = a.productCode ? 1 : 0;
      const bc = b.productCode ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return a.id - b.id;
    });
    const master = sorted[0];
    const archived = sorted.slice(1);
    const baseName = clean(master.name)!;

    const pick = (field: keyof ProductRow) => {
      if (master[field] != null) return null;
      for (const m of members) {
        const v = m[field];
        if (v != null && v !== "") return v as string;
      }
      return null;
    };

    const weights: { weight: string | null; defaultColor: string | null }[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      const w = clean(m.bottleWeight);
      const k = w || "";
      if (seen.has(k)) continue;
      seen.add(k);
      weights.push({ weight: w, defaultColor: clean(m.bottleColour) });
    }

    plan.push({
      key,
      baseName,
      master,
      archived,
      fields: {
        industry: pick("industry"),
        machineType: pick("machineType"),
        materialType: pick("materialType"),
        hsnCode: pick("hsnCode"),
        defaultUnit: pick("defaultUnit"),
        capColour: pick("capColour"),
        category: pick("category"),
      },
      weights,
    });
  }
  return plan;
}

async function main() {
  console.log(`Product Master/Variant backfill — ${APPLY ? "APPLY mode (writes DB)" : "DRY RUN (no writes)"}\n`);

  if (APPLY) await ensureVariantsTable();

  const products = await db.select().from(productsTable).orderBy(productsTable.id);
  console.log(`Loaded ${products.length} products.\n`);

  const plan = buildPlan(products);

  let totalArchived = 0;
  let totalVariants = 0;
  let totalRepointed = 0;

  await db.transaction(async (tx) => {
    for (const group of plan) {
      const masters = group.archived.length === 0 ? "MASTER (unchanged)" : "MASTER + merges " + group.archived.map((m) => `#${m.id}`).join(", ");
      console.log(`\n▸ "${group.baseName}"  →  ${masters}`);
      if (group.archived.length === 0) continue;

      // ── master row update ──
      const masterPatch: Record<string, any> = {};
      if (clean(group.master.name) !== group.baseName) masterPatch.name = group.baseName;
      for (const [field, value] of Object.entries(group.fields)) {
        if (value != null) masterPatch[field] = value;
      }
      if (group.master.status !== "active") masterPatch.status = "active";
      const masterChanges = Object.keys(masterPatch);
      console.log(`   master #${group.master.id}: ${masterChanges.length > 0 ? masterChanges.join(", ") : "no attribute changes"}`);

      // ── archive members ──
      for (const m of group.archived) {
        console.log(`   archive #${m.id} "${m.name}" (was ${m.status})`);
        if (APPLY) await tx.update(productsTable).set({ status: "inactive" }).where(eq(productsTable.id, m.id));
      }
      totalArchived += group.archived.length;

      // ── insert variants ──
      for (const v of group.weights) {
        console.log(`   variant: weight=${v.weight ?? "(none)"}  defaultColor=${v.defaultColor ?? "(none)"}`);
        if (APPLY) await tx.insert(productVariantsTable).values({ productId: group.master.id, weight: v.weight, defaultColor: v.defaultColor });
      }
      totalVariants += group.weights.length;

      // ── repoint explicit product_id references ──
      const archivedIds = group.archived.map((m) => m.id);
      const repoint = async (label: string, table: any) => {
        for (const id of archivedIds) {
          const res = await tx.execute(sql`SELECT count(*)::int AS c FROM ${table} WHERE product_id = ${id}`);
          const n = Number(res.rows[0]?.c ?? 0);
          if (n > 0) {
            console.log(`   repoint ${label}: product_id #${id} → #${group.master.id} (${n} rows)`);
            totalRepointed += n;
            if (APPLY) await tx.execute(sql`UPDATE ${table} SET product_id = ${group.master.id} WHERE product_id = ${id}`);
          }
        }
      };
      await repoint("proforma_invoice_items", proformaInvoiceItemsTable);
      await repoint("order_items", orderItemsTable);
      await repoint("deal_products", dealProductsTable);

      // ── best-effort: link NULL product_id rows whose name matches the group ──
      for (const { label, table } of [
        { label: "proforma_invoice_items", table: proformaInvoiceItemsTable },
        { label: "order_items", table: orderItemsTable },
      ]) {
        const res = await tx.execute(sql`SELECT count(*)::int AS c FROM ${table} WHERE product_id IS NULL AND lower(btrim(product_name)) = lower(${group.baseName})`);
        const n = Number(res.rows[0]?.c ?? 0);
        if (n > 0) {
          console.log(`   repoint ${label}: NULL product_id name-match → #${group.master.id} (${n} rows)`);
          totalRepointed += n;
          if (APPLY) await tx.execute(sql`UPDATE ${table} SET product_id = ${group.master.id} WHERE product_id IS NULL AND lower(btrim(product_name)) = lower(${group.baseName})`);
        }
      }

      if (APPLY) {
        if (masterChanges.length > 0 || group.master.status !== "active") {
          await tx.update(productsTable).set({ ...masterPatch, status: "active" }).where(eq(productsTable.id, group.master.id));
        }
      }
    }
  });

  console.log(`\n========================================`);
  console.log(`Merged groups:   ${plan.filter((g) => g.archived.length > 0).length}`);
  console.log(`Archived rows:   ${totalArchived}`);
  console.log(`Variant rows:    ${totalVariants}`);
  console.log(`Repointed refs:  ${totalRepointed}`);
  console.log(APPLY ? "Done — changes committed." : "DRY RUN — no changes written. Re-run with --apply to commit.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
