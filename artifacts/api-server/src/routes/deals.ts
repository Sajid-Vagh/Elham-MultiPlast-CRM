import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, categoryHistoryTable, activitiesTable, DEAL_STAGES, STAGE_PROBS, ordersTable, orderItemsTable, proformaInvoicesTable, proformaInvoiceItemsTable, productionOrdersTable, productionTimelineTable } from "@workspace/db";
import { eq, and, SQL, sql, desc, gte, between, isNull } from "drizzle-orm";
import { getAccessibleUnits } from "../lib/unit-filter";
import {
  CreateDealBody, UpdateDealBody, GetDealParams, UpdateDealParams, DeleteDealParams,
  ListDealsQueryParams, AddDealProductBody, AddDealProductParams, RemoveDealProductParams
} from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { promoteDealToExistingCustomer } from "./existing-customers";
import { generateId } from "../lib/id-generator";
import { completePendingActivitiesForDeal } from "../lib/activity-helpers";

const router: IRouter = Router();

async function enrichDeal(deal: typeof dealsTable.$inferSelect) {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
  let salesOwner = null;
  if (deal.salesOwnerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, deal.salesOwnerId));
    if (u) { const { passwordHash: _, ...safe } = u; salesOwner = safe; }
  }
  // Fetch active proforma invoice for this deal
  const [activePI] = await db
    .select({
      id: proformaInvoicesTable.id,
      invoiceNumber: proformaInvoicesTable.invoiceNumber,
      status: proformaInvoicesTable.status,
      grandTotal: proformaInvoicesTable.grandTotal,
      version: proformaInvoicesTable.version,
      isActive: proformaInvoicesTable.isActive,
      createdAt: proformaInvoicesTable.createdAt,
    })
    .from(proformaInvoicesTable)
    .where(and(
      eq(proformaInvoicesTable.dealId, deal.id),
      eq(proformaInvoicesTable.isActive, true),
      eq(proformaInvoicesTable.isDeleted, false),
    ))
    .limit(1);
  return { ...deal, contact: contact ?? null, salesOwner, activeProformaInvoice: activePI ?? null };
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

    // Pipeline view: show deals for "Regular Follow up" contacts + all "My Client" contacts
    // Completed (Won/Lost) deal visibility is controlled by completedDealVisibility param
    let resultDeals = deals;
    if (isPipelineView) {
      const regularFollowUpIds = new Set(contacts.filter(c => c.category === "Regular Follow up").map(c => c.id));
      const myClientIds = new Set(
        deals.filter(d => contacts.some(c => c.id === d.contactId && c.category === "My Client")).map(d => d.id)
      );
      resultDeals = deals.filter(d => regularFollowUpIds.has(d.contactId) || myClientIds.has(d.id));

      // Apply completed deal visibility filter based on user preference
      // completedDealVisibility values:
      //   "hide"    → hide Won/Lost immediately
      //   "24h"     → keep visible for 24 hours after completion (default)
      //   "3d"      → keep visible for 72 hours
      //   "forever" → never auto-hide completed deals
      if (params.success) {
        const visibility = params.data.completedDealVisibility || "24h";
        if (visibility === "forever") {
          // Keep all completed deals visible — no filter needed
        } else if (visibility === "24h") {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          resultDeals = resultDeals.filter(d => {
            if (d.stage !== "Won" && d.stage !== "Lost") return true;
            if (!d.completedAt) return true;
            return new Date(d.completedAt) >= cutoff;
          });
        } else if (visibility === "3d") {
          const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
          resultDeals = resultDeals.filter(d => {
            if (d.stage !== "Won" && d.stage !== "Lost") return true;
            if (!d.completedAt) return true;
            return new Date(d.completedAt) >= cutoff;
          });
        } else {
          // "hide" or any other value: hide Won/Lost immediately
          resultDeals = resultDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost");
        }
      }
    }

    if (params.success && params.data.unit) {
      const unitContacts = new Set(contacts.filter(c => c.unit === params.data.unit).map(c => c.id));
      resultDeals = resultDeals.filter(d => unitContacts.has(d.contactId));
    }

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      const allowedContactIds = new Set(
        contacts.filter(c => accessibleUnits.includes(c.unit)).map(c => c.id)
      );
      resultDeals = resultDeals.filter(d => allowedContactIds.has(d.contactId));
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
    // EXCEPTION: My Clients stay in My Client permanently — the deal serves as the active opportunity
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, parsed.data.contactId));
    if (contact && contact.category !== "Regular Follow up" && !contact.isMyClient) {
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
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (!contact || !accessibleUnits.includes(contact.unit)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
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
    // Validate PI Sent: Active Proforma Invoice must exist for this deal
    if (updateData.stage === "PI Sent") {
      const [activePI] = await db.select().from(proformaInvoicesTable).where(and(
        eq(proformaInvoicesTable.dealId, params.data.id),
        eq(proformaInvoicesTable.isActive, true),
        eq(proformaInvoicesTable.isDeleted, false),
      )).limit(1);
      if (!activePI) {
        res.status(400).json({ error: "No active Proforma Invoice found for this Deal. Create a PI before moving to PI Sent." });
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
      // Read otherReason and lostNotes from req.body (not in generated schema)
      const body = req.body as Record<string, any>;
      updateData.otherReason = body.otherReason || null;
      updateData.lostNotes = body.lostNotes || null;
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
        if (contact.isMyClient) {
          // Already a permanent My Client — just mark this deal as converted
          await db.update(dealsTable).set({
            convertedToClient: true,
            convertedAt: new Date(),
          }).where(eq(dealsTable.id, deal.id));
        } else {
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

        // Promote to Existing Customers so Support team sees them immediately
        try {
          const owner = deal.salesOwnerId || user.id;
          await promoteDealToExistingCustomer(deal.contactId, owner);
        } catch (promoErr) {
          console.error("Failed to promote deal won contact to existing customer:", promoErr);
        }
      }
    }

    // Restore contact category when deal is Lost
    // EXCEPTION: My Clients is permanent — they stay in My Client regardless
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
    if (deal.stage === "Lost") {
      if (contact) {
        if (contact.isMyClient) {
          // My Clients is permanent — contact stays in My Client, nothing to restore
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
        const reason = parsed.data.lostReason || "No reason provided";
        const body = req.body as Record<string, any>;
        const other = body.otherReason;
        const displayReason = reason === "Other" && other ? `Other - ${other}` : reason;
        activityNotes = `Deal marked as Lost\n\nLost Reason: ${displayReason}`;
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

      // Auto-complete all pending activities for this deal
      if (stage === "Won" || stage === "Lost") {
        await completePendingActivitiesForDeal(db, deal.id, deal.contactId, stage, user.id);
      }

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

// ============================================================
// POST /deals/:id/mark-won
// Atomic "Mark Deal as Won" — creates Order + Production Order
// + activities + notifications in a single transaction
// ============================================================
router.post("/deals/:id/mark-won", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const dealId = Number(req.params.id);
    if (isNaN(dealId)) { res.status(400).json({ error: "Invalid deal id" }); return; }

    const { wonAmount, productionUnit, productionNotes, salesNotes } = req.body as Record<string, any>;

    // Validate required fields
    if (wonAmount == null || isNaN(Number(wonAmount)) || Number(wonAmount) <= 0) {
      res.status(400).json({ error: "Won Amount is required and must be greater than 0" });
      return;
    }
    if (!productionUnit || !["Himatnagar", "Surat", "Rajkot"].includes(productionUnit)) {
      res.status(400).json({ error: "Production Unit is required (Himatnagar, Surat, or Rajkot)" });
      return;
    }

    // Fetch the deal
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    // Permission check
    if (user.role === "sales" && deal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Prevent re-won
    if (deal.stage === "Won") {
      res.status(400).json({ error: "This deal is already marked as Won" }); return;
    }

    // Check for existing order from this deal
    const [existingOrder] = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.dealId, dealId))
      .limit(1);
    if (existingOrder) {
      res.status(409).json({ error: "This Deal already has an Order" }); return;
    }

    // Fetch contact
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));

    // Fetch latest proforma invoice for this deal (fallback: by contact_id)
    let [latestPI] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.dealId, dealId))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(1);

    if (!latestPI && deal.contactId) {
      const [contactPI] = await db
        .select()
        .from(proformaInvoicesTable)
        .where(eq(proformaInvoicesTable.contactId, deal.contactId))
        .orderBy(desc(proformaInvoicesTable.createdAt))
        .limit(1);
      if (contactPI) {
        latestPI = contactPI;
        // Link the PI to this deal for future lookups
        await db.update(proformaInvoicesTable).set({ dealId: dealId }).where(eq(proformaInvoicesTable.id, contactPI.id));
      }
    }

    // Fetch proforma invoice items (if PI exists)
    let piItems: any[] = [];
    if (latestPI) {
      piItems = await db
        .select()
        .from(proformaInvoiceItemsTable)
        .where(eq(proformaInvoiceItemsTable.invoiceId, latestPI.id));
    }

    // ── BEGIN TRANSACTION ──
    const result = await db.transaction(async (tx) => {
      const now = new Date();

      // 1. Update Deal → Won
      await tx.update(dealsTable).set({
        stage: "Won",
        wonAmount: String(Number(wonAmount)),
        probability: 100,
        completedAt: now,
        notes: salesNotes || deal.notes,
      }).where(eq(dealsTable.id, dealId));

      // 2. Convert Contact → My Client (if not already)
      if (contact && !contact.isMyClient) {
        const prevCategory = contact.category;
        await tx.update(contactsTable).set({
          category: "My Client",
          isMyClient: true,
          customerSince: now.toISOString(),
          customerStatus: "Active",
          lastPurchaseDate: now.toISOString().split("T")[0],
        }).where(eq(contactsTable.id, contact.id));

        await tx.update(dealsTable).set({
          convertedToClient: true,
          convertedAt: now,
        }).where(eq(dealsTable.id, dealId));

        await tx.insert(categoryHistoryTable).values({
          contactId: contact.id,
          previousCategory: prevCategory,
          newCategory: "My Client",
          changedBy: user.id,
          reason: "Deal Won - Auto converted to My Client",
        });
      } else if (deal.convertedToClient === false) {
        await tx.update(dealsTable).set({
          convertedToClient: true,
          convertedAt: now,
        }).where(eq(dealsTable.id, dealId));
      }

      // 3. Create Order
      const orderNumber = await generateId("order");
      const [order] = await tx.insert(ordersTable).values({
        orderNumber,
        contactId: deal.contactId,
        customerName: contact?.name || "Unknown",
        companyName: contact?.companyName || null,
        mobile: contact?.mobile || null,
        email: contact?.email || null,
        gstNumber: contact?.gstNumber || null,
        address: contact?.address || null,
        city: contact?.city || null,
        state: contact?.state || null,
        source: "New Lead",
        customerType: "Existing Customer",
        status: "Pending Verification",
        salesOwnerId: deal.salesOwnerId || user.id,
        createdBy: user.id,
        dealId: deal.id,
        productionUnit: productionUnit || null,
        productionRemarks: productionNotes || null,
        totalAmount: latestPI?.grandTotal || "0",
        grandTotal: latestPI?.grandTotal || "0",
        freight: latestPI?.freight || "0",
        paymentTerms: latestPI?.paymentTerms || null,
        deliveryTerms: latestPI?.deliveryTerms || null,
      }).returning();

      // 4. Copy Proforma Items → Order Items
      if (piItems.length > 0) {
        for (const item of piItems) {
          await tx.insert(orderItemsTable).values({
            orderId: order.id,
            productName: item.productName,
            hsnCode: item.hsnCode || null,
            bottleType: item.bottleType || null,
            capacity: item.capacity || null,
            bottleWeight: item.weight || null,
            quantity: String(item.quantity),
            unit: item.unit || "Pcs",
            rate: String(item.rate || 0),
            gstPercent: String(item.gstPercent || 0),
            amount: String(item.amount || 0),
            status: "Pending",
          });
        }

        // Recalculate totals from order items
        const allItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
        const totalAmount = allItems.reduce((s, i) => s + Number(i.amount || 0), 0);
        const totalGst = allItems.reduce((s, i) => s + Number(i.amount || 0) * Number(i.gstPercent || 0) / 100, 0);
        const grandTotal = totalAmount + totalGst + Number(order.freight || 0);

        await tx.update(ordersTable).set({
          totalAmount: String(totalAmount),
          totalGst: String(totalGst),
          grandTotal: String(grandTotal),
        }).where(eq(ordersTable.id, order.id));
      }

      // 5. Create Production Order (if PI exists or always)
      let productionOrder: any = null;
      const [existingPO] = latestPI
        ? await tx.select().from(productionOrdersTable).where(eq(productionOrdersTable.proformaInvoiceId, latestPI.id)).limit(1)
        : [];
      if (!existingPO) {
        const [po] = await tx.insert(productionOrdersTable).values({
          proformaInvoiceId: latestPI?.id || null,
          dealId: deal.id,
          status: "Pending",
          priority: "Medium",
          productionUnit,
          productionRemarks: productionNotes || null,
          updatedBy: user.id,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        }).returning();
        productionOrder = po;

        // Timeline entry
        if (po) {
          await tx.insert(productionTimelineTable).values({
            productionOrderId: po.id,
            status: "Pending",
            notes: `Order received from ${user.name} (${user.role === "production_and_support" ? "Production & Support" : "Sales"}) — Production Unit: ${productionUnit}`,
            createdBy: user.id,
          });
        }
      }

      // 6. Update Proforma Invoice status → "Converted to Production"
      if (latestPI && latestPI.status !== "Converted to Production" && latestPI.status !== "Converted to Order") {
        await tx.update(proformaInvoicesTable).set({
          status: "Converted to Production",
        }).where(eq(proformaInvoicesTable.id, latestPI.id));
      }

      // 7. Activity Log entries
      const ts = now.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const activityEntries = [
        `Deal Won — ₹${Number(wonAmount).toLocaleString("en-IN")}\n\nBy: ${user.name}\n${ts}`,
        `Order Created — ${orderNumber}\n\nAuto-created from Deal Won\n${ts}`,
        productionOrder ? `Production Order Created — Unit: ${productionUnit}\n\nBy: ${user.name}\n${ts}` : null,
        `Production Unit Assigned — ${productionUnit}\n\nBy: ${user.name}\n${ts}`,
        productionNotes ? `Production Notes Added — ${productionNotes}\n\nBy: ${user.name}\n${ts}` : null,
      ].filter(Boolean);

      for (const notes of activityEntries) {
        await tx.insert(activitiesTable).values({
          dealId: deal.id,
          contactId: deal.contactId,
          type: "Note",
          notes,
          createdBy: user.id,
        });
      }

      // 7b. Auto-complete all pending activities for this deal
      await completePendingActivitiesForDeal(tx, deal.id, deal.contactId, "Won", user.id);

      // 8. Notifications
      // 8a. Notify sales owner
      const notifyUserId = deal.salesOwnerId || user.id;
      if (notifyUserId && notifyUserId !== user.id) {
        await createNotification({
          userId: notifyUserId,
          type: "deal_won",
          title: "Deal Won! 🎉",
          message: `Deal "${deal.title || `#${deal.id}`}" has been marked as Won.\nWon Amount: ₹${Number(wonAmount).toLocaleString("en-IN")}\nOrder: ${orderNumber}\nBy: ${user.name}`,
          link: `/deals/${deal.id}`,
          relatedId: deal.id,
          relatedType: "deal",
        });
      }

      // 8b. Notify admins
      const admins = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
      for (const admin of admins) {
        if (admin.id !== user.id && admin.id !== notifyUserId) {
          await createNotification({
            userId: admin.id,
            type: "deal_won",
            title: "Deal Won",
            message: `Deal "${deal.title || `#${deal.id}`}" won for ${contact?.name || "Unknown"}\nWon Amount: ₹${Number(wonAmount).toLocaleString("en-IN")}\nOrder: ${orderNumber}\nBy: ${user.name}`,
            link: `/deals/${deal.id}`,
            relatedId: deal.id,
            relatedType: "deal",
          });
        }
      }

      // 8c. Notify production team (unit-filtered)
      const productionUsers = await tx
        .select({ id: usersTable.id, unit: usersTable.unit, role: usersTable.role })
        .from(usersTable)
        .where(and(
          eq(usersTable.role, "production"),
        ));
      const adminUsers = await tx
        .select({ id: usersTable.id, unit: usersTable.unit, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.role, "admin"));
      const allNotifiable = [...productionUsers, ...adminUsers];

      const firstProduct = piItems[0]?.productName || "Multiple Items";
      const totalQty = piItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0);
      const unit = piItems[0]?.unit || "pcs";
      const remarksLine = productionNotes ? `\nProduction Notes: ${productionNotes}` : "";

      for (const pu of allNotifiable) {
        if (pu.id === user.id) continue;

        const userUnit = pu.unit || "All";
        const shouldNotify =
          pu.role === "admin" ||
          userUnit === "All" ||
          userUnit === productionUnit ||
          productionUnit === "Himatnagar";

        if (!shouldNotify) continue;

        await createNotification({
          userId: pu.id,
          type: "production_order_created",
          title: "New Production Order (Deal Won)",
          message: [
            `Created By: ${user.name} (${user.role === "production_and_support" ? "Production & Support" : "Sales"})`,
            `Production Unit: ${productionUnit}`,
            ``,
            `Customer: ${contact?.name || "Unknown"}`,
            `Company: ${contact?.companyName || "N/A"}`,
            `Product: ${firstProduct}`,
            totalQty > 0 ? `Quantity: ${totalQty.toLocaleString("en-IN")} ${unit}` : null,
            `Order No: ${orderNumber}`,
            `Won Amount: ₹${Number(wonAmount).toLocaleString("en-IN")}`,
            remarksLine,
          ].filter(Boolean).join("\n"),
          link: `/production/orders/${productionOrder?.id || ""}`,
          relatedId: productionOrder?.id || order.id,
          relatedType: "production_order",
        });
      }

      // 9. Promote to Existing Customers
      try {
        const owner = deal.salesOwnerId || user.id;
        await promoteDealToExistingCustomer(deal.contactId, owner);
      } catch (promoErr) {
        console.error("Failed to promote deal won contact to existing customer:", promoErr);
      }

      return { order, productionOrder, orderNumber };
    });

    // ── END TRANSACTION ──

    // Count how many deals this user has won today (server local timezone)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dealsTable)
      .where(
        and(
          eq(dealsTable.salesOwnerId, user.id),
          eq(dealsTable.stage, "Won"),
          gte(dealsTable.completedAt, todayStart),
        )
      );
    const todayWonCount = countResult?.count ?? 1;

    res.json({
      success: true,
      message: "Deal marked as Won successfully",
      orderNumber: result.orderNumber,
      orderId: result.order.id,
      productionOrderId: result.productionOrder?.id || null,
      deal: await enrichDeal(deal),
      todayWonCount,
    });
  } catch (err) {
    req.log.error({ err }, "Mark deal as Won error");
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
