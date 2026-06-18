import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, categoryHistoryTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import {
  CreateDealBody, UpdateDealBody, GetDealParams, UpdateDealParams, DeleteDealParams,
  ListDealsQueryParams, AddDealProductBody, AddDealProductParams, RemoveDealProductParams
} from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

async function enrichDeal(deal: typeof dealsTable.$inferSelect) {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
  let salesOwner = null;
  if (deal.salesOwnerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, deal.salesOwnerId));
    if (u) { const { passwordHash: _, ...safe } = u; salesOwner = safe; }
  }
  return { ...deal, contact: contact ?? null, salesOwner };
}

router.get("/deals", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const params = ListDealsQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];

    if (user.role === "sales") {
      conditions.push(eq(dealsTable.salesOwnerId, user.id));
    }

    if (params.success) {
      if (params.data.contactId) conditions.push(eq(dealsTable.contactId, params.data.contactId));
      if (params.data.salesOwnerId && user.role === "admin") conditions.push(eq(dealsTable.salesOwnerId, params.data.salesOwnerId));
      if (params.data.stage) conditions.push(eq(dealsTable.stage, params.data.stage));
    }
    const deals = conditions.length
      ? await db.select().from(dealsTable).where(and(...conditions)).orderBy(dealsTable.createdAt)
      : await db.select().from(dealsTable).orderBy(dealsTable.createdAt);

    const contacts = await db.select().from(contactsTable);
    const users = await db.select().from(usersTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const userMap = new Map(users.map(u => { const { passwordHash: _, ...safe } = u; return [u.id, safe]; }));

    if (params.success && params.data.unit) {
      const unitContacts = new Set(contacts.filter(c => c.unit === params.data.unit).map(c => c.id));
      const filtered = deals.filter(d => unitContacts.has(d.contactId));
      res.json(filtered.map(d => ({ ...d, contact: contactMap.get(d.contactId) ?? null, salesOwner: d.salesOwnerId ? userMap.get(d.salesOwnerId) ?? null : null })));
      return;
    }

    res.json(deals.map(d => ({ ...d, contact: contactMap.get(d.contactId) ?? null, salesOwner: d.salesOwnerId ? userMap.get(d.salesOwnerId) ?? null : null })));
  } catch (err) {
    req.log.error({ err }, "List deals error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deals", async (req, res) => {
  const parsed = CreateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const stageProbabilities: Record<string, number> = {
    "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60,
    "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0
  };
  const probability = parsed.data.probability ?? stageProbabilities[parsed.data.stage] ?? 10;
  try {
    const [deal] = await db.insert(dealsTable).values({ ...parsed.data, probability }).returning();
    res.status(201).json(await enrichDeal(deal!));
  } catch (err) {
    req.log.error({ err }, "Create deal error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/deals/:id", async (req, res) => {
  const parsed = GetDealParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, parsed.data.id));
    if (!deal) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && deal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await enrichDeal(deal));
  } catch (err) {
    req.log.error({ err }, "Get deal error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/deals/:id", async (req, res) => {
  const params = UpdateDealParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateDealBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const stageProbabilities: Record<string, number> = {
    "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60,
    "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0
  };
  const updateData: any = { ...parsed.data };
  if (parsed.data.stage && !parsed.data.probability) {
    updateData.probability = stageProbabilities[parsed.data.stage] ?? 10;
  }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [oldDeal] = await db.select().from(dealsTable).where(eq(dealsTable.id, params.data.id));
    if (!oldDeal) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && oldDeal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (user.role === "sales" && parsed.data.salesOwnerId !== undefined && parsed.data.salesOwnerId !== oldDeal.salesOwnerId) {
      delete updateData.salesOwnerId;
    }

    const [deal] = await db.update(dealsTable).set(updateData).where(eq(dealsTable.id, params.data.id)).returning();
    if (!deal) { res.status(404).json({ error: "Not found" }); return; }

    // Auto-set contact category when deal is Won
    if (deal.stage === "Won" && !deal.convertedToClient) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (contact) {
        const now = new Date().toISOString();
        const prevCategory = contact.category;

        await db.update(contactsTable).set({
          category: "My Client",
          customerSince: now,
          customerStatus: "Active",
          lastPurchaseDate: now.split("T")[0],
        }).where(eq(contactsTable.id, contact.id));

        await db.update(dealsTable).set({
          convertedToClient: true,
          convertedAt: new Date(),
        }).where(eq(dealsTable.id, deal.id));

        await db.insert(categoryHistoryTable).values({
          contactId: contact.id,
          previousCategory: prevCategory,
          newCategory: "My Client",
          changedBy: user.id,
          reason: "Deal Won - Auto converted to My Client",
        });
      }
    }

    // Auto-set contact category when deal is Lost (with lostCategory)
    if (deal.stage === "Lost" && parsed.data.lostCategory) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (contact) {
        const prevCategory = contact.category;
        const categoryMap: Record<string, string> = {
          A: "Category A",
          B: "Category B",
          C: "Category C",
        };
        const newCategory = categoryMap[parsed.data.lostCategory] || "Category C";

        await db.update(contactsTable).set({ category: newCategory }).where(eq(contactsTable.id, contact.id));

        await db.insert(categoryHistoryTable).values({
          contactId: contact.id,
          previousCategory: prevCategory,
          newCategory,
          changedBy: user.id,
          reason: `Deal Lost - Categorized as ${newCategory}`,
        });
      }
    }

    const assignedByName = user?.name || "Admin";

    const newOwnerId = parsed.data.salesOwnerId;
    if (newOwnerId !== undefined && newOwnerId !== oldDeal.salesOwnerId) {
      const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, newOwnerId));
      if (owner) {
        await createNotification({
          userId: newOwnerId,
          type: "assignment",
          title: "Deal Assigned",
          message: `Deal for ${deal.title || `Deal #${deal.id}`}\nAssigned By: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      }
    }

    if (parsed.data.stage && parsed.data.stage !== oldDeal.stage) {
      const stage = parsed.data.stage;
      if (stage === "Won" && deal.salesOwnerId) {
        await createNotification({
          userId: deal.salesOwnerId,
          type: "deal_won",
          title: "Deal Won! 🎉",
          message: `Deal "${deal.title || `#${deal.id}`}" has been marked as Won.\nBy: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      } else if (stage === "Lost" && deal.salesOwnerId) {
        await createNotification({
          userId: deal.salesOwnerId,
          type: "deal_lost",
          title: "Deal Lost",
          message: `Deal "${deal.title || `#${deal.id}`}" has been marked as Lost.\nBy: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      }
    }

    res.json(await enrichDeal(deal));
  } catch (err) {
    req.log.error({ err }, "Update deal error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/deals/:id", async (req, res) => {
  const params = DeleteDealParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role === "sales") {
      const [deal] = await db.select({ salesOwnerId: dealsTable.salesOwnerId }).from(dealsTable).where(eq(dealsTable.id, params.data.id));
      if (!deal || deal.salesOwnerId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    await db.delete(dealsTable).where(eq(dealsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete deal error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/deals/:id/products", async (req, res) => {
  const parsed = AddDealProductParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const items = await db.select().from(dealProductsTable).where(eq(dealProductsTable.dealId, parsed.data.id));
    const products = await db.select().from(productsTable);
    const productMap = new Map(products.map(p => [p.id, p]));
    res.json(items.map(i => ({ ...i, product: productMap.get(i.productId) ?? null })));
  } catch (err) {
    req.log.error({ err }, "List deal products error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deals/:id/products", async (req, res) => {
  const params = AddDealProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = AddDealProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const [item] = await db.insert(dealProductsTable).values({ dealId: params.data.id, ...parsed.data }).returning();
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, item!.productId));
    res.status(201).json({ ...item, product: product ?? null });
  } catch (err) {
    req.log.error({ err }, "Add deal product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/deals/:id/products/:productId", async (req, res) => {
  const params = RemoveDealProductParams.safeParse({ id: Number(req.params.id), productId: Number(req.params.productId) });
  if (!params.success) { res.status(400).json({ error: "Invalid params" }); return; }
  try {
    await db.delete(dealProductsTable).where(
      and(eq(dealProductsTable.dealId, params.data.id), eq(dealProductsTable.id, params.data.productId))
    );
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Remove deal product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
