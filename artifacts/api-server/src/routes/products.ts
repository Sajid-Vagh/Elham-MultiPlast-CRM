import { Router, type IRouter } from "express";
import { db, productsTable, productVariantsTable, usersTable } from "@workspace/db";
import { eq, inArray, or, and, sql } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody, GetProductParams, UpdateProductParams, DeleteProductParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

const DUPLICATE_MSG = "Product Code already exists. Please use a different Product Code.";
const PRODUCT_MGMT_ROLES = ["admin", "production_and_support"];

type VariantInput = { weight?: string | null; defaultColor?: string | null; isActive?: boolean | null };

async function attachVariants<T extends { id: number }>(rows: T[]) {
  if (rows.length === 0) return rows as (T & { variants: any[]; variantCount: number })[];
  const variants = await db.select().from(productVariantsTable)
    .where(inArray(productVariantsTable.productId, rows.map(r => r.id)))
    .orderBy(productVariantsTable.weight);
  const byProduct = new Map<number, any[]>();
  for (const v of variants) {
    const list = byProduct.get(v.productId) || [];
    list.push(v);
    byProduct.set(v.productId, list);
  }
  return rows.map(r => {
    const list = byProduct.get(r.id) || [];
    return { ...r, variants: list, variantCount: list.length };
  }) as (T & { variants: any[]; variantCount: number })[];
}

// ── SEARCH ──
router.get("/products/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 1) { res.json([]); return; }
    const qLower = q.toLowerCase();
    const products = await db
      .select()
      .from(productsTable)
      .where(and(
        or(
          sql`LOWER(${productsTable.name}) LIKE ${`%${qLower}%`}`,
          sql`LOWER(${productsTable.productCode}) LIKE ${`%${qLower}%`}`,
          sql`LOWER(${productsTable.bottleWeight}) LIKE ${`%${qLower}%`}`,
          sql`LOWER(${productsTable.bottleColour}) LIKE ${`%${qLower}%`}`,
          sql`LOWER(${productsTable.materialType}) LIKE ${`%${qLower}%`}`,
        ),
        eq(productsTable.status, "active"),
      ))
      .orderBy(productsTable.name)
      .limit(20);
    res.json(await attachVariants(products));
  } catch (err) {
    req.log.error({ err }, "Search products error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── LIST ──
router.get("/products", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const search = (req.query.search as string || "").trim();
    let products;
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      products = await db.select().from(productsTable).where(
        or(
          sql`LOWER(${productsTable.name}) LIKE ${q}`,
          sql`LOWER(${productsTable.productCode}) LIKE ${q}`,
          sql`LOWER(${productsTable.hsnCode}) LIKE ${q}`,
          sql`LOWER(${productsTable.bottleWeight}) LIKE ${q}`,
        )
      ).orderBy(productsTable.name);
    } else {
      products = await db.select().from(productsTable).orderBy(productsTable.name);
    }
    res.json(await attachVariants(products));
  } catch (err) {
    req.log.error({ err }, "List products error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── CREATE ── (Admin + Support)
router.post("/products", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!PRODUCT_MGMT_ROLES.includes(user.role)) {
    res.status(403).json({ error: "Permission Denied" }); return;
  }
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  try {
    // Duplicate product code check (only if code is provided)
    if (parsed.data.productCode) {
      const [existing] = await db.select({ id: productsTable.id }).from(productsTable)
        .where(eq(productsTable.productCode, parsed.data.productCode!)).limit(1);
      if (existing) {
        res.status(409).json({ error: DUPLICATE_MSG });
        return;
      }
    }
    const variants: VariantInput[] = Array.isArray((parsed.data as any).variants) ? (parsed.data as any).variants : [];
    const { variants: _variants, ...rest } = (parsed.data as any);
    const insertData = {
      ...rest,
      pricePerUnit: (rest as any).pricePerUnit?.toString() ?? null,
      defaultGst: (rest as any).defaultGst?.toString() ?? null,
    } as any;

    let product;
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(productsTable).values(insertData).returning();
      product = created;
      if (variants.length > 0) {
        await tx.insert(productVariantsTable).values(
          variants.map(v => ({ productId: created.id, weight: v.weight || null, defaultColor: v.defaultColor || null, isActive: v.isActive ?? true }))
        );
      }
    });

    // Notify admins about new product
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      if (admin.id !== user.id) {
        await createNotification({
          createdById: user.id,
          userId: admin.id,
          type: "product_added",
          title: "New Product Added",
          message: `Product "${product!.name}"${product!.productCode ? ` (Code: ${product!.productCode})` : ""} has been added.\nAdded By: ${user.name}`,
          link: `/products`,
          relatedId: product!.id,
          relatedType: "product",
        });
      }
    }

    const [enriched] = await attachVariants([product!]);
    res.status(201).json(enriched);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: DUPLICATE_MSG });
      return;
    }
    req.log.error({ err }, "Create product error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── GET BY ID ──
router.get("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = GetProductParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parsed.data.id));
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    const [enriched] = await attachVariants([product]);
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Get product error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── UPDATE ── (Admin + Support)
router.patch("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!PRODUCT_MGMT_ROLES.includes(user.role)) {
    res.status(403).json({ error: "Permission Denied" }); return;
  }
  const params = UpdateProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    // Duplicate product code check (only if code is provided)
    if (parsed.data.productCode) {
      const [existing] = await db.select({ id: productsTable.id }).from(productsTable)
        .where(eq(productsTable.productCode, parsed.data.productCode!))
        .limit(1);
      if (existing && existing.id !== params.data.id) {
        res.status(409).json({ error: DUPLICATE_MSG });
        return;
      }
    }
    const variants = "variants" in parsed.data ? (parsed.data as any).variants : undefined;
    const { variants: _variants, ...rest } = (parsed.data as any);
    const updateData = { ...rest } as any;
    if ("pricePerUnit" in rest) {
      updateData.pricePerUnit = rest.pricePerUnit?.toString() ?? null;
    }
    if ("defaultGst" in rest) {
      updateData.defaultGst = rest.defaultGst?.toString() ?? null;
    }

    let product;
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(productsTable).set(updateData).where(eq(productsTable.id, params.data.id)).returning();
      product = updated;
      if (Array.isArray(variants)) {
        await tx.delete(productVariantsTable).where(eq(productVariantsTable.productId, params.data.id));
        const list: VariantInput[] = variants;
        if (list.length > 0) {
          await tx.insert(productVariantsTable).values(
            list.map(v => ({ productId: params.data.id, weight: v.weight || null, defaultColor: v.defaultColor || null, isActive: v.isActive ?? true }))
          );
        }
      }
    });
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    const [enriched] = await attachVariants([product]);
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Update product error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ── DELETE ── (Admin + Support)
router.delete("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!PRODUCT_MGMT_ROLES.includes(user.role)) {
    res.status(403).json({ error: "Permission Denied" }); return;
  }
  const params = DeleteProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(productsTable).where(eq(productsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete product error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
