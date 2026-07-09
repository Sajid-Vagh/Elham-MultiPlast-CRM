import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, categoryHistoryTable, activitiesTable, DEAL_STAGES, STAGE_PROBS } from "@workspace/db";
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

    let isPipelineView = true;
    if (params.success) {
      if (params.data.contactId) { conditions.push(eq(dealsTable.contactId, params.data.contactId)); isPipelineView = false; }
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

    // Pipeline view: only show deals for contacts in "Regular Follow up" category
    let resultDeals = deals;
    if (isPipelineView) {
      const regularFollowUpIds = new Set(contacts.filter(c => c.category === "Regular Follow up").map(c => c.id));
      resultDeals = deals.filter(d => regularFollowUpIds.has(d.contactId));

      // Show/hide completed deals in pipeline based on setting
      // showCompletedFor24Hours=true → keep Won/Lost visible for 24h
      // showCompletedFor24Hours=not true → hide Won/Lost immediately
      if (params.success) {
        if (params.data.showCompletedFor24Hours === "true") {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          resultDeals = resultDeals.filter(d => {
            if (d.stage !== "Won" && d.stage !== "Lost") return true;
            if (!d.completedAt) return true;
            return new Date(d.completedAt) >= cutoff;
          });
        } else {
          resultDeals = resultDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost");
        }
      }
    }

    if (params.success && params.data.unit) {
      const unitContacts = new Set(contacts.filter(c => c.unit === params.data.unit).map(c => c.id));
      const filtered = resultDeals.filter(d => unitContacts.has(d.contactId));
      res.json(filtered.map(d => ({ ...d, contact: contactMap.get(d.contactId) ?? null, salesOwner: d.salesOwnerId ? userMap.get(d.salesOwnerId) ?? null : null })));
      return;
    }

    res.json(resultDeals.map(d => ({ ...d, contact: contactMap.get(d.contactId) ?? null, salesOwner: d.salesOwnerId ? userMap.get(d.salesOwnerId) ?? null : null })));
  } catch (err) {
    req.log.error({ err }, "List deals error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deals", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  // Validate Lost: lostReason is mandatory
  if (parsed.data.stage === "Lost") {
    if (!parsed.data.lostReason) {
      res.status(400).json({ error: "Lost reason is required before marking as Lost." });
      return;
    }
  }
  const probability = parsed.data.probability ?? STAGE_PROBS[parsed.data.stage] ?? 10;
  try {
    // Auto-set contact category to Regular Follow up when creating a deal
    // Regular Follow Up is a temporary working state while a deal is active
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, parsed.data.contactId));
    if (contact && contact.category !== "Regular Follow up") {
      await db.update(contactsTable).set({ category: "Regular Follow up" }).where(eq(contactsTable.id, contact.id));
    }
    const [deal] = await db.insert(dealsTable).values({ ...parsed.data, probability }).returning();

    // Notify sales owner about new deal
    const dealOwnerId = deal!.salesOwnerId || contact?.salesOwnerId;
    if (dealOwnerId && dealOwnerId !== user.id) {
      await createNotification({
        userId: dealOwnerId,
        type: "deal_created",
        title: "New Deal Created",
        message: `Deal "${deal!.title || `#${deal!.id}`}" has been created for ${contact?.name || "Unknown"}\nStage: ${deal!.stage}\nCreated By: ${user.name}`,
        link: `/deals/${deal!.id}`,
        relatedId: deal!.id,
        relatedType: "deal",
      });
    }

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
  const updateData: any = { ...parsed.data };
  if (parsed.data.stage && !parsed.data.probability) {
    updateData.probability = STAGE_PROBS[parsed.data.stage] ?? 10;
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
    if (user.role === "sales") {
      delete updateData.salesOwnerId;
    }

    // Validate Won: wonAmount is mandatory and must be > 0
    if (updateData.stage === "Won") {
      const value = updateData.wonAmount ?? oldDeal.wonAmount;
      if (value == null || Number(value) <= 0) {
        res.status(400).json({ error: "Won Amount is required and must be greater than 0 before marking as Won." });
        return;
      }
    }
    // Validate Lost: lostReason is mandatory
    if (updateData.stage === "Lost") {
      const reason = parsed.data.lostReason;
      if (!reason) {
        res.status(400).json({ error: "Lost reason is required before marking as Lost." });
        return;
      }
    }

    // Set completedAt when stage transitions to Won or Lost; clear when moving away
    if (updateData.stage === "Won" || updateData.stage === "Lost") {
      updateData.completedAt = new Date();
    } else if (updateData.stage && oldDeal.stage !== updateData.stage && (oldDeal.stage === "Won" || oldDeal.stage === "Lost")) {
      updateData.completedAt = null;
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
          isMyClient: true,
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

    // Restore contact category when deal is Lost
    // EXCEPTION: My Clients is permanent — restore existing My Clients back to My Client
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
    if (deal.stage === "Lost") {
      if (contact) {
        if (contact.isMyClient && contact.category !== "My Client") {
          // Restore existing My Client back to My Client category
          await db.update(contactsTable).set({ category: "My Client" }).where(eq(contactsTable.id, contact.id));
          await db.insert(categoryHistoryTable).values({
            contactId: contact.id,
            previousCategory: contact.category,
            newCategory: "My Client",
            changedBy: user.id,
            reason: "Deal Lost - Restored to My Client",
          });
        } else if (parsed.data.lostCategory) {
          // Move to Category A/B/C based on lostCategory value
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
      const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      // Create activity for stage change
      let activityNotes: string;
      if (stage === "Lost") {
        const lostReason = parsed.data.lostReason || "No reason provided";
        activityNotes = `Deal marked as Lost\n\nReason:\n"${lostReason}"\n\n${now}`;
      } else {
        activityNotes = `${user.name} moved deal stage from "${oldDeal.stage}" to "${stage}"\n\n${now}`;
      }
      await db.insert(activitiesTable).values({
        dealId: deal.id,
        contactId: deal.contactId,
        type: "Note",
        notes: activityNotes,
        createdBy: user.id,
      });

      const isReopened = (oldDeal.stage === "Won" || oldDeal.stage === "Lost") && stage !== "Won" && stage !== "Lost";
      const notifyUserId = deal.salesOwnerId || oldDeal.salesOwnerId;

      if (stage === "Won" && notifyUserId) {
        await createNotification({
          userId: notifyUserId,
          type: "deal_won",
          title: "Deal Won! 🎉",
          message: `Deal "${deal.title || `#${deal.id}`}" has been marked as Won.\nBy: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
        // Notify admins about won deals
        const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
        for (const admin of admins) {
          if (admin.id !== user.id && admin.id !== notifyUserId) {
            await createNotification({
              userId: admin.id,
              type: "deal_won",
              title: "Deal Won",
              message: `Deal "${deal.title || `#${deal.id}`}" won for ${contact?.name || "Unknown"}\nBy: ${assignedByName}`,
              link: `/deals/${deal.id}`,
              relatedId: deal.id,
              relatedType: "deal",
            });
          }
        }
      } else if (stage === "Lost" && notifyUserId) {
        await createNotification({
          userId: notifyUserId,
          type: "deal_lost",
          title: "Deal Lost",
          message: `Deal "${deal.title || `#${deal.id}`}" has been marked as Lost.\nBy: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      } else if (isReopened && notifyUserId) {
        await createNotification({
          userId: notifyUserId,
          type: "deal_reopened",
          title: "Deal Reopened",
          message: `Deal "${deal.title || `#${deal.id}`}" has been reopened from "${oldDeal.stage}" to "${stage}".\nBy: ${assignedByName}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      } else if (notifyUserId && notifyUserId !== user.id) {
        // General stage change notification
        await createNotification({
          userId: notifyUserId,
          type: "deal_stage_changed",
          title: "Deal Stage Updated",
          message: `Deal "${deal.title || `#${deal.id}`}" moved from "${oldDeal.stage}" to "${stage}".\nBy: ${assignedByName}`,
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
