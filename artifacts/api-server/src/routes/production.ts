import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import {
  db, productionOrdersTable, productionMessagesTable,
  proformaInvoicesTable, contactsTable, usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { storage } from "../lib/storage";
import { canAccessProduction, type PermissionUser } from "../lib/permission-service";
import {
  enrichProductionOrder, acceptOrder, updatePlanning, startProduction,
  updateStatus, cancelOrder, addNote, getMessages, sendMessage,
  getDashboard, listOrders, getOrderDetail, getAuditTrail,
  getPendingSummary, getPendingRequirements, getReports,
  getProgressByDeal, getProductionByContact, getModifiedSince,
  handlePiModification, approveModification, addTimelineEntry,
  completeDispatch,
} from "../lib/production-service";
import { transferOrder, getTransferHistory } from "../lib/production-transfer-service";

const router: IRouter = Router();

const builtyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only PDF, JPG, PNG, WEBP files allowed"));
  },
});

async function requireAuth(req: any, res: any): Promise<PermissionUser | null> {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return user;
}

async function requireProductionUser(req: any, res: any): Promise<PermissionUser | null> {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (!canAccessProduction(user)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

// ── Pending Production Requirements ──
router.get("/production/pending-requirements", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.json(await getPendingRequirements(user));
  } catch (err) {
    console.error("Get pending requirements error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Pending Production Summary ──
router.get("/production/pending-summary", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { unit: unitFilter } = req.query as Record<string, string | undefined>;
    res.json(await getPendingSummary(user, unitFilter));
  } catch (err) {
    console.error("Pending production summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Dashboard KPIs ──
router.get("/production/dashboard", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { unit: unitFilter } = req.query as Record<string, string | undefined>;
    res.json(await getDashboard(user, unitFilter));
  } catch (err) {
    console.error("Production dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List Production Orders ──
router.get("/production/orders", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { status, priority, search, dateFrom, dateTo, createdBy, unit, page, limit } = req.query as Record<string, string | undefined>;
    res.json(await listOrders(user, { status, priority, search, dateFrom, dateTo, createdBy, unit, page, limit }));
  } catch (err) {
    console.error("List production orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Single Production Order ──
router.get("/production/orders/:id", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await getOrderDetail(user, id);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Get production order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get by Proforma Invoice ID ──
router.get("/production/by-invoice/:invoiceId", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const invoiceId = Number(req.params.invoiceId);
    if (isNaN(invoiceId)) { res.status(400).json({ error: "Invalid invoice id" }); return; }

    const [order] = await db.select().from(productionOrdersTable)
      .where(eq(productionOrdersTable.proformaInvoiceId, invoiceId));
    if (!order) { res.json(null); return; }

    const result = await getOrderDetail(user, order.id);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Get production by invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get by Contact ID ──
router.get("/production/by-contact/:contactId", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contact id" }); return; }
    res.json(await getProductionByContact(user, contactId));
  } catch (err) {
    console.error("Get production by contact error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 2: Accept Order ──
router.post("/production/orders/:id/accept", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await acceptOrder(user, id);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Accept production order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 3: Update Planning ──
router.patch("/production/orders/:id/planning", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { machine, expectedStartDate, expectedCompletionDate, expectedDispatchDate, priority, notes } = req.body;
    const result = await updatePlanning(user, id, { machine, expectedStartDate, expectedCompletionDate, expectedDispatchDate, priority, notes });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Update planning error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 4: Start Production (Machine Running) ──
router.post("/production/orders/:id/start", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await startProduction(user, id);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Start production error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update Status (generic) ──
router.patch("/production/orders/:id/status", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { status, notes } = req.body;
    const result = await updateStatus(user, id, status, notes);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Update production status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 10: Cancel Order ──
router.post("/production/orders/:id/cancel", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { reason } = req.body;
    if (!reason || !reason.trim()) { res.status(400).json({ error: "Cancellation reason is required" }); return; }
    const result = await cancelOrder(user, id, reason);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Cancel production order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 6: Approve/Reject PI Modification ──
router.post("/production/orders/:id/approve-modification", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { approve } = req.body;
    if (typeof approve !== "boolean") { res.status(400).json({ error: "approve must be a boolean" }); return; }
    const result = await approveModification(user, id, approve);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Approve modification error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 5: Transfer Order ──
router.patch("/production/orders/:id/transfer", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { targetUnit, reason, remarks } = req.body;
    const result = await transferOrder(user, id, targetUnit, reason, remarks);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Transfer production order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Transfer History ──
router.get("/production/orders/:id/transfers", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    res.json(await getTransferHistory(id));
  } catch (err) {
    console.error("Get transfer history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 13: Audit Trail ──
router.get("/production/orders/:id/audit-trail", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    res.json(await getAuditTrail(id));
  } catch (err) {
    console.error("Get audit trail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scenario 8: Add Note ──
router.post("/production/orders/:id/notes", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { note, noteType } = req.body;
    if (!note || !note.trim()) { res.status(400).json({ error: "Note is required" }); return; }
    const result = await addNote(user, id, note, noteType);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.status(201).json(result.note);
  } catch (err) {
    console.error("Add production note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Complete Dispatch (Support team) ──
router.patch("/production/orders/:id/dispatch", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { transportName, transportDetails, builtyUrl } = req.body;
    const result = await completeDispatch(user, id, { transportName, transportDetails, builtyUrl });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Complete dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Upload Builty ──
router.post("/production/orders/:id/builty", builtyUpload.single("file"), async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (user.role !== "admin" && user.role !== "production_and_support") {
      res.status(403).json({ error: "Only production & support or admin users can upload builty" });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }

    const storagePath = await storage.save(file.originalname, file.buffer, "builty");
    const fileUrl = `/uploads/builty/${path.basename(storagePath)}`;
    await db.update(productionOrdersTable).set({ builtyUrl: fileUrl, updatedAt: new Date() })
      .where(eq(productionOrdersTable.id, id));

    res.json({ url: fileUrl, originalName: file.originalname });
  } catch (err) {
    console.error("Builty upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get Messages ──
router.get("/production/orders/:id/messages", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    res.json(await getMessages(id));
  } catch (err) {
    console.error("Get production messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Send Message ──
router.post("/production/orders/:id/messages", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { message } = req.body;
    if (!message || !message.trim()) { res.status(400).json({ error: "Message is required" }); return; }
    const result = await sendMessage(user, id, message);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.status(201).json(result.message);
  } catch (err) {
    console.error("Send production message error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Reports ──
router.get("/production/reports", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { unit, status, dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    res.json(await getReports(user, { unit, status, dateFrom, dateTo }));
  } catch (err) {
    console.error("Production reports error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Progress by Deal ──
router.get("/production/progress-by-deal/:dealId", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const dealId = Number(req.params.dealId);
    if (isNaN(dealId)) { res.status(400).json({ error: "Invalid deal id" }); return; }
    const result = await getProgressByDeal(user, dealId);
    if (result?.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  } catch (err) {
    console.error("Get production progress by deal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Modified Since (polling) ──
router.get("/production/modified-since", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { since } = req.query as Record<string, string | undefined>;
    res.json(await getModifiedSince(user, since));
  } catch (err) {
    console.error("Modified since error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
