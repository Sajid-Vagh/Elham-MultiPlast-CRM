import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import {
  db, productionOrdersTable, productionMessagesTable,
  proformaInvoicesTable, proformaInvoiceItemsTable,
  contactsTable, usersTable, productsTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { storage } from "../lib/storage";
import { canAccessProduction, type PermissionUser } from "../lib/permission-service";
import { buildWorkbook, sendWorkbook, type SheetDef, todayStr, safeStr } from "../lib/exporter";
import {
  enrichProductionOrder, acceptOrder, updatePlanning, startProduction,
  completePacking, markReadyForDispatch, bookTransport, completeOrder,
  cancelOrder, addNote, getMessages, sendMessage,
  getDashboard, listOrders, getOrderDetail, getAuditTrail,
  getPendingSummary, getPendingRequirements, getReports,
  getProgressByDeal, getProductionByContact, getModifiedSince,
  handlePiModification, approveModification, addTimelineEntry,
  getManufacturingSummary, getManufacturingSummaryDetail,
  updateOrderStatus,
  loadVehicle, markDispatched, markDelivered,
  getDispatchDashboard, listDispatchOrders,
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
    const { unit: unitFilter } = req.query as Record<string, string | undefined>;
    res.json(await getPendingRequirements(user, unitFilter));
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
    const { unit: unitFilter, origin: originFilter, startDate, endDate } = req.query as Record<string, string | undefined>;
    res.json(await getDashboard(user, unitFilter, originFilter, startDate, endDate));
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
    const { status, dispatchStatus, priority, search, dateFrom, dateTo, createdBy, unit, origin, page, limit } = req.query as Record<string, string | undefined>;
    res.json(await listOrders(user, { status, dispatchStatus, priority, search, dateFrom, dateTo, createdBy, unit, origin, page, limit }));
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

// ── Accept Order ──
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

// ── Update Planning ──
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

// ── Start Production (Production On Going) ──
router.post("/production/orders/:id/start", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { machine, operatorName, notes } = req.body;
    const result = await startProduction(user, id, { machine, operatorName, notes });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Start production error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Complete Packing ──
router.post("/production/orders/:id/packing", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { packingType, notes } = req.body;
    if (!packingType || !["Bundle", "Packet"].includes(packingType)) {
      res.status(400).json({ error: "packingType must be 'Bundle' or 'Packet'" }); return;
    }
    const result = await completePacking(user, id, { packingType, notes });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Packing error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Mark Ready To Dispatch ──
router.post("/production/orders/:id/ready-for-dispatch", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { notes } = req.body;
    const result = await markReadyForDispatch(user, id, notes);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Ready for dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Book Transport (Support team) ──
router.post("/production/orders/:id/transport", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { transportCompany, bookingNumber } = req.body;
    if (!transportCompany || !transportCompany.trim()) {
      res.status(400).json({ error: "Transport company is required" }); return;
    }
    if (!bookingNumber || !bookingNumber.trim()) {
      res.status(400).json({ error: "Booking/Bilty number is required" }); return;
    }
    const result = await bookTransport(user, id, { transportCompany: transportCompany.trim(), bookingNumber: bookingNumber.trim() });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Book transport error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Complete Order ──
router.post("/production/orders/:id/complete", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await completeOrder(user, id);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Complete order error:", err);
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
    const { status, remarks, voiceNoteId, expectedCompletionDate, productionRemarks } = req.body;
    if (!status || !status.trim()) { res.status(400).json({ error: "Status is required" }); return; }
    const result = await updateOrderStatus(user, id, { status: status.trim(), remarks, voiceNoteId, expectedCompletionDate, productionRemarks });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Update production status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cancel Order ──
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

// ── Approve/Reject PI Modification ──
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

// ── Transfer Order ──
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

// ── Audit Trail ──
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

// ── Add Note ──
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
    const { unit, status, dateFrom, dateTo, origin } = req.query as Record<string, string | undefined>;
    res.json(await getReports(user, { unit, status, dateFrom, dateTo, origin }));
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

// ── Manufacturing Summary ──
router.get("/production/manufacturing-summary", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { unit: unitFilter, origin: originFilter, material: materialFilter } = req.query as Record<string, string | undefined>;
    res.json(await getManufacturingSummary(user, unitFilter, originFilter, materialFilter));
  } catch (err) {
    console.error("Manufacturing summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Manufacturing Summary Detail ──
router.get("/production/manufacturing-summary/detail", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { productName, weight, colour, ids } = req.query as Record<string, string | undefined>;
    if (productName && weight && colour) {
      res.json(await getManufacturingSummaryDetail(user, { productName, weight, colour }));
    } else if (ids) {
      const orderIds = ids.split(",").map(Number).filter(n => !isNaN(n));
      if (!orderIds.length) { res.json({ items: [] }); return; }
      res.json(await getManufacturingSummaryDetail(user, { orderIds }));
    } else {
      res.status(400).json({ error: "productName, weight, colour params required (or ids)" });
    }
  } catch (err) {
    console.error("Manufacturing summary detail error:", err);
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

// ═══════════════════════════════════════════════════
// DISPATCH WORKFLOW ENDPOINTS (Support team)
// ═══════════════════════════════════════════════════

// ── Dispatch Dashboard KPIs ──
router.get("/production/dispatch-dashboard", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const result = await getDispatchDashboard(user);
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  } catch (err) {
    console.error("Dispatch dashboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List Dispatch Orders ──
router.get("/production/dispatch-orders", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const { status, search, page, limit } = req.query as Record<string, string | undefined>;
    const result = await listDispatchOrders(user, { status, search, page, limit });
    if (result.error) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  } catch (err) {
    console.error("List dispatch orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Load Vehicle (Pending Dispatch → Load Vehicle) ──
router.post("/production/orders/:id/load-vehicle", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid order ID" });
      return;
    }
    const { transportName, lrNumber, builtyUrl, dispatchRemarks } = req.body;
    if (!transportName || !String(transportName).trim()) {
      res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Transport name is required", field: "transportName" });
      return;
    }
    if (!lrNumber || !String(lrNumber).trim()) {
      res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "LR / Builty number is required", field: "lrNumber" });
      return;
    }
    const result = await loadVehicle(user, id, {
      transportName: String(transportName).trim(), lrNumber: String(lrNumber).trim(),
      builtyUrl, dispatchRemarks,
    });
    if (result.error || result.success === false) {
      res.status(result.status || 400).json(result);
      return;
    }
    res.json(result.order);
  } catch (err) {
    console.error("Load vehicle error:", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
  }
});

// ── Mark Dispatched (Load Vehicle → Dispatch) ──
router.post("/production/orders/:id/dispatch", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid order ID" }); return; }
    const result = await markDispatched(user, id);
    if (result.error || result.success === false) { res.status(result.status || 400).json(result); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Mark dispatched error:", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
  }
});

// ── Mark Delivered (Dispatch → Delivered) ──
router.post("/production/orders/:id/deliver", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid order ID" }); return; }
    const result = await markDelivered(user, id);
    if (result.error || result.success === false) { res.status(result.status || 400).json(result); return; }
    res.json(result.order);
  } catch (err) {
    console.error("Mark delivered error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════
// PRODUCTION SHEET — Download Excel for operators
// ═══════════════════════════════════════════════════

// ── GET /production/sheet/stats — Dashboard widget ──
router.get("/production/sheet/stats", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const { unit: unitFilter } = req.query as Record<string, string | undefined>;

    const conditions: any[] = [
      sql`po.status NOT IN ('Completed', 'Cancelled')`,
    ];

    if (unitFilter && unitFilter !== "All" && unitFilter !== "all") {
      conditions.push(sql`po.production_unit = ${unitFilter}`);
    } else if (user.role !== "admin") {
      const u = (user as any).unit || "All";
      if (u !== "All") conditions.push(sql`po.production_unit = ${u}`);
    }

    const whereSql = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [stats] = await db.execute(sql`
      SELECT
        COUNT(*)::int AS "totalPending",
        COUNT(*) FILTER (WHERE po.needs_reprint = true)::int AS "needsReprint",
        COUNT(*) FILTER (WHERE po.production_sheet_version = 0)::int AS "neverGenerated",
        COUNT(*) FILTER (WHERE po.production_sheet_version > 0 AND po.needs_reprint = true)::int AS "outdated"
      FROM production_orders po
      ${whereSql}
    `);

    res.json({
      totalPending: stats?.totalPending || 0,
      needsReprint: stats?.needsReprint || 0,
      neverGenerated: stats?.neverGenerated || 0,
      outdated: stats?.outdated || 0,
    });
  } catch (err) {
    console.error("Production sheet stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /production/sheet — Download Excel production sheet ──
// Modes: new (default), pending, selected, today, week, month, reprint, date-range, all
router.get("/production/sheet", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;

    const mode = (req.query.mode as string) || "new";
    const orderIdsRaw = (req.query.orderIds as string) || "";
    const dateFrom = (req.query.dateFrom as string) || undefined;
    const dateTo = (req.query.dateTo as string) || undefined;
    const unitFilter = (req.query.unit as string) || undefined;

    // ── 1. Build base query conditions ──
    const conditions: any[] = [
      sql`po.status NOT IN ('Completed', 'Cancelled')`,
    ];

    if (unitFilter && unitFilter !== "All" && unitFilter !== "all") {
      conditions.push(sql`po.production_unit = ${unitFilter}`);
    } else if (user.role !== "admin") {
      const u = (user as any).unit || "All";
      if (u !== "All") conditions.push(sql`po.production_unit = ${u}`);
    }

    // ── 2. Apply mode filter ──
    if (mode === "new") {
      // Only orders with productionSheetVersion = 0 (never downloaded)
      conditions.push(sql`po.production_sheet_version = 0`);
    } else if (mode === "pending") {
      conditions.push(sql`po.status IN ('Pending')`);
    } else if (mode === "selected" && orderIdsRaw) {
      const ids = orderIdsRaw.split(",").map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        conditions.push(sql`po.id IN ${ids}`);
      } else {
        // No valid IDs — return empty
        const emptyWb = buildWorkbook([{
          name: "Production Sheet",
          headers: ["No orders selected"],
          rows: [[""]],
        }], `Production Sheet — ${todayStr()}`);
        await sendWorkbook(res, emptyWb, `production-sheet-${todayStr()}`);
        return;
      }
    } else if (mode === "today") {
      conditions.push(sql`DATE(po.created_at) = CURRENT_DATE`);
    } else if (mode === "week") {
      conditions.push(sql`po.created_at >= CURRENT_DATE - INTERVAL '7 days'`);
    } else if (mode === "month") {
      conditions.push(sql`po.created_at >= CURRENT_DATE - INTERVAL '30 days'`);
    } else if (mode === "reprint") {
      conditions.push(sql`po.needs_reprint = true`);
    } else if (mode === "date-range") {
      if (dateFrom) conditions.push(sql`po.created_at >= ${dateFrom}::timestamptz`);
      if (dateTo) {
        conditions.push(sql`po.created_at <= (${dateTo}::timestamptz + INTERVAL '1 day')`);
      }
    }
    // mode = "all" → no extra conditions

    const whereSql = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // ── 3. Fetch production orders with PI items, contacts, products ──
    const results = await db.execute(sql`
      SELECT
        po.id AS "poId",
        po.status AS "poStatus",
        po.priority AS "priority",
        po.production_unit AS "productionUnit",
        po.production_remarks AS "productionRemarks",
        po.planned_machine AS "plannedMachine",
        po.created_at AS "createdAt",
        po.needs_reprint AS "needsReprint",
        po.production_sheet_version AS "sheetVersion",
        pi.invoice_number AS "piNumber",
        pi.created_at AS "piDate",
        c.customer_code AS "customerCode",
        c.company_name AS "companyName",
        c.mobile AS "customerMobile",
        c.city AS "customerCity",
        c.special_instructions AS "specialInstructions",
        pii.id AS "itemId",
        pii.product_name AS "productName",
        pii.hsn_code AS "hsnCode",
        pii.bottle_type AS "bottleType",
        pii.capacity AS "capacity",
        pii.weight AS "weight",
        pii.quantity AS "quantity",
        pii.unit AS "unit",
        p.product_code AS "productCode",
        p.bottle_colour AS "bottleColour",
        p.bottle_weight AS "bottleWeight",
        p.cap_colour AS "capColour",
        p.material_type AS "materialType",
        p.machine_type AS "machineType"
      FROM production_orders po
      LEFT JOIN proforma_invoices pi ON pi.id = po.proforma_invoice_id
      LEFT JOIN proforma_invoice_items pii ON pii.invoice_id = pi.id
      LEFT JOIN contacts c ON c.id = pi.contact_id
      LEFT JOIN products p ON LOWER(p.name) = LOWER(pii.product_name)
      ${whereSql}
      ORDER BY po.id, pii.id
    `);

    if (!results.rows || results.rows.length === 0) {
      const emptyWb = buildWorkbook([{
        name: "Production Sheet",
        headers: ["Info"],
        rows: [["No orders found for the selected filter"]],
      }], `Production Sheet — ${todayStr()}`);
      await sendWorkbook(res, emptyWb, `production-sheet-${todayStr()}`);
      return;
    }

    // ── 4. Determine next version for each order ──
    const poIds = [...new Set(results.rows.map((r: any) => r.poId))];

    // ── 5. Build Excel rows: one row per product per order ──
    const sheetNumber = `PS-${new Date().getFullYear()}-${String(Math.floor(Date.now() / 1000) % 100000).padStart(5, "0")}`;

    const headers = [
      // Order Information
      "Sheet #", "Order #", "PI #", "Customer Code", "Order Date", "Priority", "Unit",
      // Product Information
      "Product Name", "Product Code", "Bottle Color", "Bottle Weight (gm)",
      "Cap Color", "Cap Weight (gm)", "Neck Size", "HSN Code",
      "Qty", "Unit", "Manufacturing Machine", "Product Remarks",
      // Operator Section (blank)
      "Production Qty", "Reject Qty", "Balance Qty", "Operator Name",
      "Start Time", "End Time", "QC Checked", "Packing Completed", "Operator Remarks",
      // Special Instructions
      "Special Instructions", "Bottle Finish", "Material Type",
      "Label Requirement", "Packing Requirement",
    ];

    const dataRows: any[][] = [];

    // Group by PO
    const grouped = new Map<number, any[]>();
    for (const row of results.rows) {
      const poId = row.poId;
      if (!grouped.has(poId)) grouped.set(poId, []);
      grouped.get(poId)!.push(row);
    }

    for (const [poId, rows] of grouped) {
      const first = rows[0];
      const version = (first.sheetVersion || 0) + 1;
      const orderDate = first.createdAt ? new Date(first.createdAt).toLocaleDateString("en-IN") : "";

      for (const row of rows) {
        if (!row.itemId) continue; // Skip orders with no PI items

        dataRows.push([
          sheetNumber,
          `PO-${poId}`,
          first.piNumber || `PI-${first.poId}`,
          row.customerCode || "",
          orderDate,
          first.priority || "",
          first.productionUnit || "",
          // Product Information
          row.productName || "",
          row.productCode || "",
          row.bottleColour || "",
          row.bottleWeight || "",
          row.capColour || "",
          "",  // Cap Weight — not in DB, operator fills
          "",  // Neck Size — not in DB, operator fills
          row.hsnCode || "",
          Number(row.quantity) || "",
          row.unit || "",
          row.machineType || row.plannedMachine || "",
          first.productionRemarks || "",
          // Operator Section — all blank
          "", "", "", "", "", "", "", "", "",
          // Special Instructions
          row.specialInstructions || "",
          row.bottleType || "",
          row.materialType || "",
          "", "",  // Label/Packing requirement
        ]);
      }
    }

    const wb = buildWorkbook([{
      name: "Production Sheet",
      headers,
      rows: dataRows,
    }], `Production Sheet — ${sheetNumber} — ${todayStr()}`);

    // ── 6. Update tracking fields for all included orders ──
    const now = new Date();
    for (const poId of poIds) {
      const row = results.rows.find((r: any) => r.poId === poId);
      const newVersion = (row?.sheetVersion || 0) + 1;
      await db.update(productionOrdersTable).set({
        productionSheetGeneratedAt: now,
        productionSheetGeneratedBy: user.id,
        productionSheetVersion: newVersion,
        needsReprint: false,
        updatedAt: now,
      }).where(eq(productionOrdersTable.id, poId));
    }

    const filename = `production-sheet-${todayStr()}`;
    await sendWorkbook(res, wb, filename);
  } catch (err) {
    console.error("Production sheet error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /production/orders/:id/mark-reprint — Toggle needsReprint ──
router.post("/production/orders/:id/mark-reprint", async (req, res) => {
  try {
    const user = await requireProductionUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid order id" }); return; }

    const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    const { needsReprint } = req.body;
    await db.update(productionOrdersTable).set({
      needsReprint: needsReprint ?? true,
      updatedAt: new Date(),
    }).where(eq(productionOrdersTable.id, id));

    res.json({ success: true, needsReprint: needsReprint ?? true });
  } catch (err) {
    console.error("Mark reprint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
