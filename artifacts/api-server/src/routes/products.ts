import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { eq, like, or, sql } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody, GetProductParams, UpdateProductParams, DeleteProductParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

const DUPLICATE_MSG = "Product Code already exists. Please use a different Product Code.";

router.get("/products/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 1) { res.json([]); return; }
    const products = await db
      .select()
      .from(productsTable)
      .where(or(
        sql`LOWER(${productsTable.name}) LIKE ${`%${q.toLowerCase()}%`}`,
        sql`LOWER(${productsTable.productCode}) LIKE ${`%${q.toLowerCase()}%`}`,
      ))
      .orderBy(productsTable.name)
      .limit(20);
    res.json(products);
  } catch (err) {
    req.log.error({ err }, "Search products error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const products = await db.select().from(productsTable).orderBy(productsTable.name);
    res.json(products);
  } catch (err) {
    req.log.error({ err }, "List products error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/products", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  try {
    const [existing] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.productCode, parsed.data.productCode)).limit(1);
    if (existing) {
      res.status(409).json({ error: DUPLICATE_MSG });
      return;
    }
    const insertData = { ...parsed.data, pricePerUnit: parsed.data.pricePerUnit?.toString() ?? null } as any;
    const [product] = await db.insert(productsTable).values(insertData).returning();
    res.status(201).json(product);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: DUPLICATE_MSG });
      return;
    }
    req.log.error({ err }, "Create product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = GetProductParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parsed.data.id));
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(product);
  } catch (err) {
    req.log.error({ err }, "Get product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    if (parsed.data.productCode) {
      const [existing] = await db.select({ id: productsTable.id }).from(productsTable)
        .where(eq(productsTable.productCode, parsed.data.productCode))
        .limit(1);
      if (existing && existing.id !== params.data.id) {
        res.status(409).json({ error: DUPLICATE_MSG });
        return;
      }
    }
    const updateData = { ...parsed.data } as any;
    if ("pricePerUnit" in parsed.data) {
      updateData.pricePerUnit = parsed.data.pricePerUnit?.toString() ?? null;
    }
    const [product] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, params.data.id)).returning();
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(product);
  } catch (err) {
    req.log.error({ err }, "Update product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/products/:id", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = DeleteProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(productsTable).where(eq(productsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
