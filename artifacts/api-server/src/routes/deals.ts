import { Router, type IRouter } from "express";
import { db, dealsTable, contactsTable, usersTable, dealProductsTable, productsTable, categoryHistoryTable, unitHistoryTable, activitiesTable, DEAL_STAGES, STAGE_PROBS, ordersTable, orderItemsTable, proformaInvoicesTable, proformaInvoiceItemsTable, proformaInvoiceHistoryTable, productionOrdersTable, productionTimelineTable } from "@workspace/db";
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
import { getActivePiForDeal, getActivePiSummary, validateActivePiForPiSent, deactivateActivePis } from "../lib/proforma-service";
import { convertContactToMyClient, checkNoExistingOrder, getTodayWonCount, validateWonPrerequisites, validateProductionUnit } from "../lib/won-service";
import { notifyProductionUsers } from "../lib/notification-service";
import { logActivity, logDealStageActivity, formatTimestamp } from "../lib/activity-logger";
import { canAccessSalesResource } from "../lib/permission-service";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";

const router: IRouter = Router();

// ── Deal Stage Transition Rules ──
// Each key maps to the set of stages it can transition TO.
// Won and Lost are terminal — they can only transition to specific stages if reopened.
const VALID_STAGE_TRANSITIONS: Record<string, string[]> = {
  "New":              ["CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"],
  "CL Sent":          ["Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"],
  "Price Given":      ["Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"],
  "Samples Sent":     ["Samples Received", "PI Sent", "Won", "Lost"],
  "Samples Received": ["PI Sent", "Won", "Lost"],
  "PI Sent":          ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "Won", "Lost"],
  "Won":              ["Lost", "New"],
  "Lost":             ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won"],
};

function isValidStageTransition(from: string, to: string): boolean {
  const allowed = VALID_STAGE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

async function enrichDeal(deal: typeof dealsTable.$inferSelect) {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
  let salesOwner = null;
  if (deal.salesOwnerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, deal.salesOwnerId));
    if (u) { const { passwordHash: _, ...safe } = u; salesOwner = safe; }
  }
  const activePI = await getActivePiSummary(db, deal.id);
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
      if (params.data.unit === PENDING_UNIT_ASSIGNMENT) {
        // Filter deals where contact unit is null (pending assignment)
        const pendingUnitContacts = new Set(
          contacts.filter(c => !c.unit).map(c => c.id)
        );
        resultDeals = resultDeals.filter(d => pendingUnitContacts.has(d.contactId));
      } else {
        const unitContacts = new Set(contacts.filter(c => c.unit === params.data.unit).map(c => c.id));
        resultDeals = resultDeals.filter(d => unitContacts.has(d.contactId));
      }
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

// ── Validate Won prerequisites (lightweight check before opening Won dialog) ──
// Checks the deal's Active Proforma Invoice directly — never depends on paginated data.
router.get("/deals/:id/validate-won", async (req, res) => {
  try {
    const parsed = GetDealParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, parsed.data.id));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    if (user.role === "sales" && deal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const activePi = await getActivePiForDeal(db, parsed.data.id);
    if (!activePi) {
      res.json({ valid: false, error: "This Deal requires an Active Sent/Approved Proforma Invoice before it can be marked Won." });
      return;
    }

    if (activePi.status !== "Sent" && activePi.status !== "Approved") {
      res.json({ valid: false, error: `This Deal requires an Active Sent/Approved Proforma Invoice before it can be marked Won. Current PI status: "${activePi.status}".` });
      return;
    }

    res.json({
      valid: true,
      pi: {
        id: activePi.id,
        invoiceNumber: activePi.invoiceNumber,
        status: activePi.status,
        taxableAmount: activePi.taxableAmount,
        grandTotal: activePi.grandTotal,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Validate won error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/deals/:id", async (req, res) => {
  console.log("[DEAL-PATCH-DEBUG] === PATCH /deals/:id START ===");
  console.log("[DEAL-PATCH-DEBUG] req.params:", JSON.stringify(req.params));
  console.log("[DEAL-PATCH-DEBUG] req.body:", JSON.stringify(req.body));
  console.log("[DEAL-PATCH-DEBUG] req.body types:", JSON.stringify(Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, typeof v]))));

  const params = UpdateDealParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    console.log("[DEAL-PATCH-DEBUG] FAIL: ParamsValidation", JSON.stringify(params.error));
    res.status(400).json({ failedAt: "ParamsValidation", issues: params.error.issues, message: "Invalid id" }); return;
  }
  console.log("[DEAL-PATCH-DEBUG] Params OK:", JSON.stringify(params.data));

  const parsed = UpdateDealBody.safeParse(req.body);
  if (!parsed.success) {
    console.log("[DEAL-PATCH-DEBUG] FAIL: BodyValidation", JSON.stringify(parsed.error));
    console.log("[DEAL-PATCH-DEBUG] FAIL: BodyValidation issues:", JSON.stringify(parsed.error.issues));
    res.status(400).json({ failedAt: "BodyValidation", issues: parsed.error.issues, message: "Invalid input" }); return;
  }
  console.log("[DEAL-PATCH-DEBUG] Body OK:", JSON.stringify(parsed.data));
  console.log("[DEAL-PATCH-DEBUG] Body field types:", JSON.stringify(Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, `${typeof v}=${v}`]))));

  const updateData: any = { ...parsed.data };
  if (parsed.data.stage && !parsed.data.probability) {
    updateData.probability = STAGE_PROBS[parsed.data.stage] ?? 10;
  }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [oldDeal] = await db.select().from(dealsTable).where(eq(dealsTable.id, params.data.id));
    if (!oldDeal) {
      console.log("[DEAL-PATCH-DEBUG] FAIL: DealNotFound id=", params.data.id);
      res.status(404).json({ error: "Not found" }); return;
    }
    console.log("[DEAL-PATCH-DEBUG] oldDeal.stage:", oldDeal.stage, "oldDeal.id:", oldDeal.id);
    if (user.role === "sales" && oldDeal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (user.role === "sales") {
      delete updateData.salesOwnerId;
    }

    console.log("[DEAL-PATCH-DEBUG] updateData after cleanup:", JSON.stringify(updateData));

    // Validate stage transition
    if (updateData.stage && updateData.stage !== oldDeal.stage) {
      console.log("[DEAL-PATCH-DEBUG] Stage transition:", oldDeal.stage, "->", updateData.stage);
      if (!isValidStageTransition(oldDeal.stage, updateData.stage)) {
        console.log("[DEAL-PATCH-DEBUG] FAIL: StageTransition");
        res.status(400).json({ failedAt: "StageTransition", message: `Cannot move deal from "${oldDeal.stage}" to "${updateData.stage}". Valid transitions: ${VALID_STAGE_TRANSITIONS[oldDeal.stage]?.join(", ") || "none"}` });
        return;
      }
    }

    // Validate Won: Active PI must exist, status must be Sent/Approved, taxableAmount used as Won Value
    if (updateData.stage === "Won") {
      console.log("[DEAL-PATCH-DEBUG] Validating Won prerequisites for deal", params.data.id);
      const piValidation = await validateWonPrerequisites({
        exec: db, dealId: params.data.id, isMarkWonEndpoint: false,
      });
      if (!piValidation.valid) {
        console.log("[DEAL-PATCH-DEBUG] FAIL: WonPrerequisites", JSON.stringify(piValidation));
        res.status(piValidation.status).json({ failedAt: "WonPrerequisites", error: piValidation.error, details: piValidation });
        return;
      }
      console.log("[DEAL-PATCH-DEBUG] Won prerequisites OK, piTaxableAmount:", piValidation.piTaxableAmount);
      // Won Value = PI Subtotal only — never GST, freight, or other charges
      updateData.wonAmount = String(piValidation.piTaxableAmount);
    }
    // Validate PI Sent: Active Proforma Invoice must exist for this deal
    if (updateData.stage === "PI Sent") {
      console.log("[DEAL-PATCH-DEBUG] Validating PI Sent prerequisites for deal", params.data.id);
      const piSentValidation = await validateActivePiForPiSent(db, params.data.id);
      if (!piSentValidation.valid) {
        console.log("[DEAL-PATCH-DEBUG] FAIL: PiSentPrerequisites", JSON.stringify(piSentValidation));
        res.status(400).json({ failedAt: "PiSentPrerequisites", error: piSentValidation.error, details: piSentValidation });
        return;
      }
      console.log("[DEAL-PATCH-DEBUG] PI Sent prerequisites OK");
    }

    // Validate Lost: lostReason is mandatory
    if (updateData.stage === "Lost") {
      const reason = parsed.data.lostReason;
      if (!reason) {
        console.log("[DEAL-PATCH-DEBUG] FAIL: LostReasonRequired");
        res.status(400).json({ failedAt: "LostReasonRequired", message: "Lost reason is required before marking as Lost." });
        return;
      }
      console.log("[DEAL-PATCH-DEBUG] Lost reason OK:", reason);
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

    console.log("[DEAL-PATCH-DEBUG] All validations passed. Final updateData:", JSON.stringify(updateData));
    const [deal] = await db.update(dealsTable).set(updateData).where(eq(dealsTable.id, params.data.id)).returning();
    console.log("[DEAL-PATCH-DEBUG] DB update result:", deal ? "SUCCESS id=" + deal.id : "NOT FOUND");
    if (!deal) { res.status(404).json({ error: "Not found" }); return; }

    // Auto-update active PI status to "Sent" when deal moves to PI Sent
    if (deal.stage === "PI Sent" && oldDeal.stage !== "PI Sent") {
      const activePI = await getActivePiForDeal(db, deal.id);
      if (activePI && activePI.status === "Draft") {
        await db.update(proformaInvoicesTable).set({ status: "Sent" }).where(eq(proformaInvoicesTable.id, activePI.id));
        await db.insert(proformaInvoiceHistoryTable).values({
          invoiceId: activePI.id,
          statusFrom: "Draft",
          statusTo: "Sent",
          changedBy: user.id,
          notes: "Auto-set: Deal moved to PI Sent",
        });
      }
    }

    // Auto-set contact category when deal is Won
    if (deal.stage === "Won" && !deal.convertedToClient) {
      const [wonContact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));
      if (wonContact) {
        await convertContactToMyClient(db, {
          contactId: deal.contactId,
          dealId: deal.id,
          userId: user.id,
          isMyClient: wonContact.isMyClient,
          convertedToClient: deal.convertedToClient,
          now: new Date(),
        });

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
      // Deactivate all active PIs for this deal
      await deactivateActivePis(db, deal.id);

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
      // Create activity for stage change
      if (stage === "Lost") {
        const reason = parsed.data.lostReason || "No reason provided";
        const body = req.body as Record<string, any>;
        const other = body.otherReason;
        const displayReason = reason === "Other" && other ? `Other - ${other}` : reason;
        await logDealStageActivity(db, {
          dealId: deal.id, contactId: deal.contactId,
          fromStage: oldDeal.stage, toStage: stage,
          userName: user.name, createdBy: user.id,
          extraNotes: `Lost Reason: ${displayReason}`,
        });
      } else {
        await logDealStageActivity(db, {
          dealId: deal.id, contactId: deal.contactId,
          fromStage: oldDeal.stage, toStage: stage,
          userName: user.name, createdBy: user.id,
        });
      }

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

    console.log("[DEAL-PATCH-DEBUG] === PATCH /deals/:id SUCCESS === deal.id:", deal.id);
    res.json(await enrichDeal(deal));
  } catch (err) {
    console.error("[DEAL-PATCH-DEBUG] === PATCH /deals/:id CATCH ERROR ===", err);
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

    const { wonAmount, productionUnit, productionNotes, salesNotes, unitChangeReason, voiceNoteId } = req.body as Record<string, any>;

    // Unified validation — single source of truth for both PATCH and mark-won
    const validation = await validateWonPrerequisites({
      exec: db, dealId, wonAmount, productionUnit, isMarkWonEndpoint: true,
    });
    if (!validation.valid) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const piTaxableAmount = validation.piTaxableAmount;

    // Fetch the deal
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    // Permission check
    if (user.role === "sales" && deal.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Fetch ACTIVE proforma invoice for this deal (single source of truth)
    const latestPI = await getActivePiForDeal(db, dealId);

    // Check for existing order from this deal (prevents duplicate orders)
    const hasExistingOrder = await checkNoExistingOrder(db, dealId);
    if (!hasExistingOrder) {
      res.status(409).json({ error: "This Deal already has an Order" }); return;
    }

    // Fetch contact
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, deal.contactId));

    // Won Value = PI Subtotal (taxableAmount) only — never GST, freight, or other charges
    const effectiveWonAmount = piTaxableAmount;

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

      // 1. Update Deal → Won (Won Value = PI Subtotal only)
      await tx.update(dealsTable).set({
        stage: "Won",
        wonAmount: String(effectiveWonAmount),
        probability: 100,
        completedAt: now,
        notes: salesNotes || deal.notes,
      }).where(eq(dealsTable.id, dealId));

      // 2. Convert Contact → My Client (single shared helper)
      if (contact) {
        await convertContactToMyClient(tx, {
          contactId: contact.id,
          dealId,
          userId: user.id,
          isMyClient: contact.isMyClient,
          convertedToClient: deal.convertedToClient,
          now,
        });

        // 2b. Update contact's production unit (first assignment at Won stage)
        if (productionUnit && !contact.unit) {
          await tx.update(contactsTable).set({ unit: productionUnit }).where(eq(contactsTable.id, contact.id));
          await tx.insert(unitHistoryTable).values({
            contactId: contact.id,
            previousUnit: contact.unit || null,
            newUnit: productionUnit,
            changedBy: user.id,
            reason: unitChangeReason || "Deal Won — Production Unit assigned",
          });
        }
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

      // 5b. Link voice note to production order (if provided)
      if (voiceNoteId && productionOrder) {
        const { voiceNotesTable } = await import("@workspace/db");
        await tx.update(voiceNotesTable).set({
          productionOrderId: productionOrder.id,
          proformaInvoiceId: latestPI?.id || null,
        }).where(eq(voiceNotesTable.id, Number(voiceNoteId)));
      }

      // 6. Update Proforma Invoice status → "Converted to Production"
      if (latestPI && latestPI.status !== "Converted to Production" && latestPI.status !== "Converted to Order") {
        await tx.update(proformaInvoicesTable).set({
          status: "Converted to Production",
        }).where(eq(proformaInvoicesTable.id, latestPI.id));
      }

      // 7. Activity Log entries (using centralized logger)
      const ts = formatTimestamp(now);
      const activityEntries = [
        `Deal Won — ₹${effectiveWonAmount.toLocaleString("en-IN")}\n\nBy: ${user.name}\n${ts}`,
        `Order Created — ${orderNumber}\n\nAuto-created from Deal Won\n${ts}`,
        productionOrder ? `Production Order Created — Unit: ${productionUnit}\n\nBy: ${user.name}\n${ts}` : null,
        `Production Unit Assigned — ${productionUnit}\n\nBy: ${user.name}\n${ts}`,
        productionNotes ? `Production Notes Added — ${productionNotes}\n\nBy: ${user.name}\n${ts}` : null,
        voiceNoteId ? `Voice Note Attached — sent by ${user.name} with Deal Won\n\nDuration: see attached audio\n${ts}` : null,
      ].filter(Boolean);

      for (const notes of activityEntries) {
        await logActivity(tx, {
          dealId: deal.id, contactId: deal.contactId,
          type: "Note", notes, createdBy: user.id,
        });
      }

      // 7b. Auto-complete all pending activities for this deal
      await completePendingActivitiesForDeal(tx, deal.id, deal.contactId, "Won", user.id);

      // 8. Notifications — using centralized helpers
      // 8a+b. Notify sales owner + admins (single shared helper)
      await notifyProductionUsers({
        productionUnit,
        title: "New Production Order (Deal Won)",
        message: [
          `Created By: ${user.name} (${user.role === "production_and_support" ? "Production & Support" : "Sales"})`,
          `Production Unit: ${productionUnit}`,
          ``,
          `Customer: ${contact?.name || "Unknown"}`,
          `Company: ${contact?.companyName || "N/A"}`,
          `Product: ${piItems[0]?.productName || "Multiple Items"}`,
          piItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0) > 0
            ? `Quantity: ${piItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0).toLocaleString("en-IN")} ${piItems[0]?.unit || "pcs"}`
            : null,
          `Order No: ${orderNumber}`,
          `Won Amount: ₹${effectiveWonAmount.toLocaleString("en-IN")}`,
          productionNotes ? `\nProduction Notes: ${productionNotes}` : null,
        ].filter(Boolean).join("\n"),
        link: `/production/orders/${productionOrder?.id || ""}`,
        relatedId: productionOrder?.id || order.id,
        relatedType: "production_order",
        type: "production_order_created",
        excludeUserId: user.id,
      });

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

    // Count how many deals this user has won today
    const todayWonCount = await getTodayWonCount(user.id);

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
