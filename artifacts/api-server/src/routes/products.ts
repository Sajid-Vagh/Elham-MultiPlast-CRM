import { Router, type IRouter } from "express";
import { db, productsTable, usersTable, productionOrdersTable, proformaInvoicesTable, proformaInvoiceItemsTable } from "@workspace/db";
import { eq, or, sql, and, inArray, isNull } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody, GetProductParams, UpdateProductParams, DeleteProductParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

const DUPLICATE_MSG = "Product Code already exists. Please use a different Product Code.";
const PRODUCT_MGMT_ROLES = ["admin", "production_and_support"];

// ── SEARCH ──
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

// ── LIST ──
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
    const insertData = {
      ...parsed.data,
      pricePerUnit: (parsed.data as any).pricePerUnit?.toString() ?? null,
      defaultGst: (parsed.data as any).defaultGst?.toString() ?? null,
    } as any;
    const [product] = await db.insert(productsTable).values(insertData).returning();

    // Notify admins about new product
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      if (admin.id !== user.id) {
        await createNotification({
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

// ── GET BY ID ──
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
    const updateData = { ...parsed.data } as any;
    if ("pricePerUnit" in parsed.data) {
      updateData.pricePerUnit = (parsed.data as any).pricePerUnit?.toString() ?? null;
    }
    if ("defaultGst" in parsed.data) {
      updateData.defaultGst = (parsed.data as any).defaultGst?.toString() ?? null;
    }
    const [product] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, params.data.id)).returning();
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(product);
  } catch (err) {
    req.log.error({ err }, "Update product error");
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── MACHINE-WISE PRODUCTION REPORT ──
// Accessible by: admin, production_and_support, production
router.get("/products/machine-report", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!["admin", "production_and_support", "production"].includes(user.role)) {
      res.status(403).json({ error: "Permission Denied" }); return;
    }

    const requestedUnit = req.query.unit as string | undefined;
    const unitFilter = (user.unit === "All" || user.role === "admin") ? requestedUnit : user.unit;
    const machineTypeFilter = req.query.machineType as string | undefined;
    const productFilter = req.query.product as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    // Unit-based access for production managers
    let accessibleUnits: string[] | null = null;
    if (user.role === "production") {
      if (user.unit && user.unit !== "All") {
        accessibleUnits = [user.unit];
      }
      // If unit is "All" or empty, production manager sees all (Himatnagar default)
    }

    // Build production order conditions
    const conditions: any[] = [];
    if (unitFilter && unitFilter !== "All") {
      conditions.push(eq(productionOrdersTable.productionUnit, unitFilter));
    } else if (accessibleUnits) {
      conditions.push(inArray(productionOrdersTable.productionUnit, accessibleUnits));
    }
    if (statusFilter && statusFilter !== "All") {
      conditions.push(eq(productionOrdersTable.status, statusFilter));
    }
    if (dateFrom) {
      conditions.push(sql`${productionOrdersTable.createdAt} >= ${dateFrom}`);
    }
    if (dateTo) {
      conditions.push(sql`${productionOrdersTable.createdAt} <= ${dateTo}::timestamp + interval '1 day'`);
    }

    // Fetch production orders
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const orders = await db
      .select({
        id: productionOrdersTable.id,
        status: productionOrdersTable.status,
        productionUnit: productionOrdersTable.productionUnit,
        createdAt: productionOrdersTable.createdAt,
        proformaInvoiceId: productionOrdersTable.proformaInvoiceId,
      })
      .from(productionOrdersTable)
      .where(whereClause);

    if (orders.length === 0) {
      res.json({
        summary: { totalOrders: 0, totalBottles: 0, totalQuantity: 0, pending: 0, inProduction: 0, completed: 0 },
        machineBreakdown: [],
        orders: [],
      });
      return;
    }

    // Fetch PI items for these orders
    const piIds = [...new Set(orders.map(o => o.proformaInvoiceId).filter(Boolean))] as number[];
    let piItems: any[] = [];
    if (piIds.length > 0) {
      piItems = await db
        .select({
          invoiceId: proformaInvoiceItemsTable.invoiceId,
          productName: proformaInvoiceItemsTable.productName,
          quantity: proformaInvoiceItemsTable.quantity,
          unit: proformaInvoiceItemsTable.unit,
        })
        .from(proformaInvoiceItemsTable)
        .where(inArray(proformaInvoiceItemsTable.invoiceId, piIds));
    }

    // Fetch products for machine type mapping
    const allProducts = await db.select().from(productsTable);
    const productMap = new Map(allProducts.map(p => [p.name?.toLowerCase(), p]));

    // Build enriched order data
    const enrichedOrders = orders.map(order => {
      const items = piItems.filter(i => i.invoiceId === order.proformaInvoiceId);
      const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const productName = items[0]?.productName || "Unknown";
      const product = productMap.get(productName.toLowerCase());
      const machineType = product?.machineType || null;

      const isInProduction = ["Production Started", "In Process", "Quality Check", "Packing"].includes(order.status);
      const isCompleted = order.status === "Completed";
      const isPending = order.status === "Pending" || order.status === "Material Ready";

      return {
        id: order.id,
        status: order.status,
        productionUnit: order.productionUnit,
        createdAt: order.createdAt,
        productName,
        machineType,
        totalQuantity: totalQty,
        isInProduction,
        isCompleted,
        isPending,
      };
    });

    // Apply machine type filter (post-filter since it's from products table)
    let filteredOrders = enrichedOrders;
    if (machineTypeFilter && machineTypeFilter !== "All") {
      filteredOrders = enrichedOrders.filter(o => o.machineType === machineTypeFilter);
    }
    if (productFilter && productFilter !== "All") {
      filteredOrders = filteredOrders.filter(o => o.productName === productFilter);
    }

    // Summary
    const summary = {
      totalOrders: filteredOrders.length,
      totalBottles: filteredOrders.reduce((s, o) => s + o.totalQuantity, 0),
      totalQuantity: filteredOrders.reduce((s, o) => s + o.totalQuantity, 0),
      pending: filteredOrders.filter(o => o.isPending).length,
      inProduction: filteredOrders.filter(o => o.isInProduction).length,
      completed: filteredOrders.filter(o => o.isCompleted).length,
    };

    // Machine-wise breakdown
    const machineMap = new Map<string, { count: number; bottles: number }>();
    for (const order of filteredOrders) {
      const key = order.machineType || "Unassigned";
      const existing = machineMap.get(key) || { count: 0, bottles: 0 };
      existing.count++;
      existing.bottles += order.totalQuantity;
      machineMap.set(key, existing);
    }
    const machineBreakdown = [...machineMap.entries()].map(([machineType, data]) => ({
      machineType,
      orderCount: data.count,
      totalBottles: data.bottles,
    }));

    res.json({ summary, machineBreakdown, orders: filteredOrders });
  } catch (err) {
    req.log.error({ err }, "Machine-wise report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
