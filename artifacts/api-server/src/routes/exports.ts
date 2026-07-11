import { Router, type IRouter } from "express";
import {
  db,
  contactsTable,
  dealsTable,
  activitiesTable,
  usersTable,
  ordersTable,
  orderItemsTable,
  customerCommunicationsTable,
  complaintsTable,
  complaintUpdatesTable,
  productionOrdersTable,
  productionTimelineTable,
  productionNotesTable,
  productionBatchesTable,
  productionBatchItemsTable,
  dispatchTable,
  dispatchItemsTable,
  existingCustomersTable,
  categoryHistoryTable,
  orderTimelineTable,
} from "@workspace/db";
import { eq, and, SQL, inArray, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import {
  buildWorkbook,
  sendWorkbook,
  type SheetDef,
  todayStr,
  safeStr,
  safeNum,
} from "../lib/exporter";

const router: IRouter = Router();

function csvFilename(prefix: string): string {
  return `${prefix}_${todayStr()}`;
}

function parseQueryParams(req: any) {
  const format = (req.query.format as string) || "xlsx";
  const mode = (req.query.mode as string) || "quick";
  const dateFrom = (req.query.dateFrom as string) || undefined;
  const dateTo = (req.query.dateTo as string) || undefined;
  const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  const unit = (req.query.unit as string) || undefined;
  const status = (req.query.status as string) || undefined;
  const search = (req.query.search as string) || undefined;
  const category = (req.query.category as string) || undefined;
  const stage = (req.query.stage as string) || undefined;
  return { format, mode, dateFrom, dateTo, ownerId, unit, status, search, category, stage };
}

function matchesDateRange(dateVal: string | Date | null | undefined, from?: string, to?: string): boolean {
  if (!dateVal) return true;
  const d = new Date(dateVal);
  if (from && d < new Date(from)) return false;
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    if (d > toDate) return false;
  }
  return true;
}

function matchesSearch(val: string | null | undefined, search?: string): boolean {
  if (!search || !val) return true;
  return val.toLowerCase().includes(search.toLowerCase());
}

function safeDate(val: any): Date | null {
  if (!val) return null;
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function nonNullIds(ids: (number | null | undefined)[]): number[] {
  return ids.filter((id): id is number => id != null && id !== undefined);
}

function contactMapById(contacts: any[], id: number | null | undefined): any | undefined {
  if (!id) return undefined;
  return contacts.find(c => c.id === id);
}

function mapGet<K, V>(m: Map<K, V>, key: K | null | undefined): V | undefined {
  if (key == null) return undefined;
  return m.get(key);
}

// ─── 1. GET /exports/reports ─────────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, stage, search } = parseQueryParams(req);

    const contacts = await db.select().from(contactsTable);
    const users = await db.select().from(usersTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const userMap = new Map(users.map(u => [u.id, u]));

    const dealConditions: SQL[] = [];
    if (user.role === "sales") dealConditions.push(eq(dealsTable.salesOwnerId, user.id));
    if (ownerId) dealConditions.push(eq(dealsTable.salesOwnerId, ownerId));
    if (stage) dealConditions.push(eq(dealsTable.stage, stage));

    const deals = dealConditions.length
      ? await db.select().from(dealsTable).where(and(...dealConditions))
      : await db.select().from(dealsTable);

    const filteredDeals = deals.filter(d => matchesDateRange(d.createdAt, dateFrom, dateTo));

    const validDealIds = nonNullIds(filteredDeals.map(d => d.id));
    const activities = validDealIds.length
      ? await db.select().from(activitiesTable).where(inArray(activitiesTable.dealId, validDealIds))
      : [];

    // ── Quick: single sheet ─────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "Deal #", "Customer", "Company", "Stage", "Probability %",
        "Deal Value", "Won Amount", "Owner", "Created", "Won/Lost Date", "Notes",
      ];
      const rows = filteredDeals.map(d => {
        const c = contactMap.get(d.contactId);
        const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : null;
        return [
          `D-${d.id}`,
          safeStr(c?.name),
          safeStr(c?.companyName),
          safeStr(d.stage),
          safeNum(d.probability),
          safeNum(d.totalValue),
          safeNum(d.wonAmount),
          safeStr(owner?.name),
          safeDate(d.createdAt),
          safeDate(d.completedAt),
          safeStr(d.notes),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Pipeline Report", headers, rows }];
      const wb = buildWorkbook(sheets, `Pipeline Report — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("pipeline-report"), format);
      return;
    }

    // ── Detailed: 3 sheets ──────────────────────────────────────────────
    const pipelineHeaders = [
      "Deal #", "Customer Name", "Company Name", "Contact Person", "Phone", "Email", "City", "State",
      "Product", "Bottle", "Capacity", "Weight", "Quantity",
      "Pipeline Stage", "Deal Status", "Expected Value", "Won Value",
      "Sales Owner", "Unit", "Created Date", "Won Date", "Lost Date", "Lost Reason",
      "Last Follow-up", "Next Follow-up", "Remarks",
    ];
    const pipelineRows = filteredDeals.map(d => {
      const c = contactMap.get(d.contactId);
      const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : null;
      return [
        `D-${d.id}`,
        safeStr(c?.name),
        safeStr(c?.companyName),
        safeStr(c?.name),
        safeStr(c?.mobile),
        safeStr(c?.email),
        safeStr(c?.city),
        safeStr(c?.state),
        "",
        "",
        "",
        "",
        "",
        safeStr(d.stage),
        safeStr(d.stage),
        safeNum(d.totalValue),
        safeNum(d.wonAmount),
        safeStr(owner?.name),
        safeStr(c?.unit),
        safeDate(d.createdAt),
        d.stage === "Won" ? safeDate(d.completedAt) : "",
        d.stage === "Lost" ? safeDate(d.completedAt) : "",
        safeStr(d.lostReason),
        "",
        "",
        safeStr(d.notes),
      ];
    });

    const activityHeaders = [
      "Activity ID", "Deal ID", "Customer", "Type", "Status",
      "Follow-up Date", "Follow-up Time", "Follow-up Type",
      "Notes", "Assigned To", "Created By", "Created",
    ];
    const activityRows = activities.map(a => {
      const c = mapGet(contactMap, a.contactId);
      const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
      const creator = a.createdBy ? userMap.get(a.createdBy) : null;
      return [
        `A-${a.id}`,
        `D-${a.dealId}`,
        safeStr(c?.name),
        safeStr(a.type),
        safeStr(a.callStatus),
        safeStr(a.followUpDate),
        safeStr(a.followUpTime),
        safeStr(a.followUpType),
        safeStr(a.notes),
        safeStr(assignee?.name),
        safeStr(creator?.name),
        safeDate(a.createdAt),
      ];
    });

    const timelineHeaders = ["Event Type", "Deal ID", "Customer", "Description", "Date"];
    const timelineRows: any[][] = [];
    for (const d of filteredDeals) {
      const c = contactMap.get(d.contactId);
      const customerName = safeStr(c?.name);
      timelineRows.push([
        "Deal Created", `D-${d.id}`, customerName, `Deal "${safeStr(d.title)}" created`, safeDate(d.createdAt),
      ]);
      if (d.completedAt) {
        timelineRows.push([
          "Deal Completed", `D-${d.id}`, customerName,
          `Stage: ${safeStr(d.stage)}${d.lostReason ? ` (${safeStr(d.lostReason)})` : ""}`,
          safeDate(d.completedAt),
        ]);
      }
    }
    for (const a of activities) {
      const c = mapGet(contactMap, a.contactId);
      timelineRows.push([
        "Activity", `D-${a.dealId}`, safeStr(c?.name),
        `${safeStr(a.type)} — ${safeStr(a.callStatus)}`, safeDate(a.createdAt),
      ]);
    }
    timelineRows.sort((a, b) => {
      const da = a[4] instanceof Date ? a[4].getTime() : 0;
      const db2 = b[4] instanceof Date ? b[4].getTime() : 0;
      return db2 - da;
    });

    const sheets: SheetDef[] = [
      { name: "Pipeline Report", headers: pipelineHeaders, rows: pipelineRows },
      { name: "Activities", headers: activityHeaders, rows: activityRows },
      { name: "Timeline", headers: timelineHeaders, rows: timelineRows },
    ];
    const wb = buildWorkbook(sheets, `Pipeline Report (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("pipeline-detailed"), format);
  } catch (err: any) {
    console.error("[exports/reports]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 2. GET /exports/contacts ────────────────────────────────────────────────
router.get("/contacts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, unit, status, search, category } = parseQueryParams(req);

    const contactConditions: SQL[] = [];
    if (user.role === "sales") contactConditions.push(eq(contactsTable.salesOwnerId, user.id));

    const contacts = contactConditions.length
      ? await db.select().from(contactsTable).where(and(...contactConditions))
      : await db.select().from(contactsTable);

    let filtered = contacts.filter(c => matchesDateRange(c.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(c => c.salesOwnerId === ownerId);
    if (unit) filtered = filtered.filter(c => c.unit === unit);
    if (status) filtered = filtered.filter(c => c.customerStatus === status);
    if (category) filtered = filtered.filter(c => c.category === category);
    if (search) {
      filtered = filtered.filter(c =>
        matchesSearch(c.name, search) ||
        matchesSearch(c.companyName, search) ||
        matchesSearch(c.mobile, search) ||
        matchesSearch(c.email, search) ||
        matchesSearch(c.city, search)
      );
    }

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Name", "Company", "Mobile", "Email", "City", "State",
        "Industry", "Unit", "Category", "Status", "Sales Owner", "Customer Since", "Created",
      ];
      const rows = filtered.map(c => {
        const owner = userMap.get(c.salesOwnerId);
        return [
          `C-${c.id}`,
          safeStr(c.name),
          safeStr(c.companyName),
          safeStr(c.mobile),
          safeStr(c.email),
          safeStr(c.city),
          safeStr(c.state),
          safeStr(c.industry),
          safeStr(c.unit),
          safeStr(c.category),
          safeStr(c.customerStatus),
          safeStr(owner?.name),
          safeStr(c.customerSince),
          safeDate(c.createdAt),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Contacts", headers, rows }];
      const wb = buildWorkbook(sheets, `Contacts — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("contacts"), format);
      return;
    }

    // ── Detailed: 4 sheets ──────────────────────────────────────────────
    const contactIds = nonNullIds(filtered.map(c => c.id));

    const orderCounts = contactIds.length ? await db.select({
      contactId: ordersTable.contactId,
      count: sql<number>`count(*)`,
      lastDate: sql<string>`max(created_at)`
    }).from(ordersTable).where(inArray(ordersTable.contactId, contactIds)).groupBy(ordersTable.contactId) : [];
    const orderMap = new Map(orderCounts.map(o => [o.contactId, o]));

    const complaintCounts = contactIds.length ? await db.select({
      contactId: complaintsTable.contactId,
      count: sql<number>`count(*)`
    }).from(complaintsTable).where(inArray(complaintsTable.contactId, contactIds)).groupBy(complaintsTable.contactId) : [];
    const complaintMap = new Map(complaintCounts.map(c => [c.contactId, c.count]));

    const detailHeaders = [
      "ID", "Customer Name", "Company", "Contact Person", "Phone", "Alternate Phone", "Email",
      "Address", "City", "State",
      "Industry", "Sales Owner",
      "Status", "Customer Since", "Last Order", "Total Orders", "Repeat Orders", "Complaint Count", "Notes", "Created",
    ];
    const detailRows = filtered.map(c => {
      const owner = userMap.get(c.salesOwnerId);
      return [
        `C-${c.id}`,
        safeStr(c.name),
        safeStr(c.companyName),
        safeStr(c.name),
        safeStr(c.mobile),
        safeStr(c.otherPhone),
        safeStr(c.email),
        safeStr(c.address),
        safeStr(c.city),
        safeStr(c.state),
        safeStr(c.industry),
        safeStr(owner?.name),
        safeStr(c.customerStatus),
        safeStr(c.customerSince),
        safeStr(orderMap.get(c.id)?.lastDate || ""),
        safeNum(orderMap.get(c.id)?.count || 0),
        0,
        safeNum(complaintMap.get(c.id) || 0),
        safeStr(c.customerComments),
        safeDate(c.createdAt),
      ];
    });

    const orders = contactIds.length
      ? await db.select().from(ordersTable).where(inArray(ordersTable.contactId, contactIds))
      : [];
    const orderHeaders = [
      "Order #", "Customer", "Company", "Status", "Grand Total", "Sales Owner", "Created",
    ];
    const orderRows = orders.map(o => {
      const owner = o.salesOwnerId ? userMap.get(o.salesOwnerId) : null;
      return [
        safeStr(o.orderNumber),
        safeStr(o.customerName),
        safeStr(o.companyName),
        safeStr(o.status),
        safeNum(o.grandTotal),
        safeStr(owner?.name),
        safeDate(o.createdAt),
      ];
    });

    const orderIds = nonNullIds(orders.map(o => o.id));
    const orderIdMap = new Map(orders.map(o => [o.id, o]));
    const allItems = orderIds.length
      ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds))
      : [];
    const itemHeaders = ["Order #", "Product", "Bottle", "Capacity", "Weight", "Cap", "Color", "Quantity", "Rate", "Amount", "Status", "Batch"];
    const itemRows = allItems.map(item => {
      const o = orderIdMap.get(item.orderId);
      return [
        safeStr(o?.orderNumber),
        safeStr(item.productName),
        safeStr(item.bottleType),
        safeStr(item.capacity),
        safeNum(item.bottleWeight),
        safeStr(item.capColour),
        safeStr(item.colour),
        safeNum(item.quantity),
        safeNum(item.rate),
        safeNum(item.amount),
        safeStr(item.status),
        safeStr(item.batchNumber),
      ];
    });

    const actConditions: SQL[] = [];
    if (contactIds.length > 0) actConditions.push(inArray(activitiesTable.contactId, contactIds));
    const followups = actConditions.length
      ? await db.select().from(activitiesTable).where(and(...actConditions))
      : [];
    const followupHeaders = [
      "Activity ID", "Customer", "Type", "Status", "Follow-up Date",
      "Follow-up Time", "Follow-up Type", "Notes", "Assigned To", "Created",
    ];
    const followupRows = followups.map(a => {
      const c = contactMapById(contacts, a.contactId);
      const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
      return [
        `A-${a.id}`,
        safeStr(c?.name),
        safeStr(a.type),
        safeStr(a.callStatus),
        safeStr(a.followUpDate),
        safeStr(a.followUpTime),
        safeStr(a.followUpType),
        safeStr(a.notes),
        safeStr(assignee?.name),
        safeDate(a.createdAt),
      ];
    });

    const comms = contactIds.length
      ? await db.select().from(customerCommunicationsTable).where(inArray(customerCommunicationsTable.contactId, contactIds))
      : [];
    const commHeaders = [
      "ID", "Customer", "Type", "Direction", "Notes",
      "Next Action", "Next Action Date", "Created By", "Department", "Created",
    ];
    const commRows = comms.map(cm => {
      const c = contactMapById(contacts, cm.contactId);
      const creator = cm.createdBy ? userMap.get(cm.createdBy) : null;
      return [
        `COM-${cm.id}`,
        safeStr(c?.name),
        safeStr(cm.type),
        safeStr(cm.direction),
        safeStr(cm.notes),
        safeStr(cm.nextAction),
        safeStr(cm.nextActionDate),
        safeStr(creator?.name),
        safeStr(cm.department),
        safeDate(cm.createdAt),
      ];
    });

    const sheets: SheetDef[] = [
      { name: "Customer Details", headers: detailHeaders, rows: detailRows },
      { name: "Order History", headers: orderHeaders, rows: orderRows },
      { name: "Order Items", headers: itemHeaders, rows: itemRows },
      { name: "Follow-up History", headers: followupHeaders, rows: followupRows },
      { name: "Communication History", headers: commHeaders, rows: commRows },
    ];
    const wb = buildWorkbook(sheets, `Contacts (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("contacts-detailed"), format);
  } catch (err: any) {
    console.error("[exports/contacts]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 3. GET /exports/deals ───────────────────────────────────────────────────
router.get("/deals", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, stage, search } = parseQueryParams(req);

    const dealConditions: SQL[] = [];
    if (user.role === "sales") dealConditions.push(eq(dealsTable.salesOwnerId, user.id));

    const deals = dealConditions.length
      ? await db.select().from(dealsTable).where(and(...dealConditions))
      : await db.select().from(dealsTable);

    let filtered = deals.filter(d => matchesDateRange(d.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(d => d.salesOwnerId === ownerId);
    if (stage) filtered = filtered.filter(d => d.stage === stage);

    const contacts = await db.select().from(contactsTable);
    const users = await db.select().from(usersTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(d => {
        const c = contactMap.get(d.contactId);
        return (
          matchesSearch(c?.name, search) ||
          matchesSearch(c?.companyName, search) ||
          matchesSearch(d.title, search) ||
          matchesSearch(d.notes, search)
        );
      });
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "Deal #", "Customer", "Company", "Stage", "Probability %",
        "Value", "Won Amount", "Owner", "Created", "Completed",
      ];
      const rows = filtered.map(d => {
        const c = contactMap.get(d.contactId);
        const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : null;
        return [
          `D-${d.id}`,
          safeStr(c?.name),
          safeStr(c?.companyName),
          safeStr(d.stage),
          safeNum(d.probability),
          safeNum(d.totalValue),
          safeNum(d.wonAmount),
          safeStr(owner?.name),
          safeDate(d.createdAt),
          safeDate(d.completedAt),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Deals", headers, rows }];
      const wb = buildWorkbook(sheets, `Deals — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("deals"), format);
      return;
    }

    // ── Detailed: 3 sheets ──────────────────────────────────────────────
    const dealHeaders = [
      "Deal #", "Title", "Customer", "Company", "Phone", "City",
      "Stage", "Probability %", "Deal Value", "Won Amount",
      "Lost Reason", "Lost Notes", "Owner", "Category",
      "Created", "Completed", "Notes",
    ];
    const dealRows = filtered.map(d => {
      const c = contactMap.get(d.contactId);
      const owner = d.salesOwnerId ? userMap.get(d.salesOwnerId) : null;
      return [
        `D-${d.id}`,
        safeStr(d.title),
        safeStr(c?.name),
        safeStr(c?.companyName),
        safeStr(c?.mobile),
        safeStr(c?.city),
        safeStr(d.stage),
        safeNum(d.probability),
        safeNum(d.totalValue),
        safeNum(d.wonAmount),
        safeStr(d.lostReason),
        safeStr(d.lostNotes),
        safeStr(owner?.name),
        safeStr(d.category),
        safeDate(d.createdAt),
        safeDate(d.completedAt),
        safeStr(d.notes),
      ];
    });

    const dealIds = nonNullIds(filtered.map(d => d.id));
    const dealActivities = dealIds.length
      ? await db.select().from(activitiesTable).where(inArray(activitiesTable.dealId, dealIds))
      : [];
    const actHeaders = [
      "Activity ID", "Deal #", "Customer", "Type", "Status",
      "Follow-up Date", "Follow-up Time", "Follow-up Type",
      "Notes", "Assigned To", "Created By", "Created",
    ];
    const actRows = dealActivities.map(a => {
      const c = mapGet(contactMap, a.contactId);
      const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
      const creator = a.createdBy ? userMap.get(a.createdBy) : null;
      return [
        `A-${a.id}`,
        `D-${a.dealId}`,
        safeStr(c?.name),
        safeStr(a.type),
        safeStr(a.callStatus),
        safeStr(a.followUpDate),
        safeStr(a.followUpTime),
        safeStr(a.followUpType),
        safeStr(a.notes),
        safeStr(assignee?.name),
        safeStr(creator?.name),
        safeDate(a.createdAt),
      ];
    });

    const timelineHeaders = ["Event", "Deal #", "Customer", "Description", "Date"];
    const timelineRows: any[][] = [];
    for (const d of filtered) {
      const c = contactMap.get(d.contactId);
      const cn = safeStr(c?.name);
      timelineRows.push(["Deal Created", `D-${d.id}`, cn, safeStr(d.title), safeDate(d.createdAt)]);
      if (d.completedAt) {
        timelineRows.push([
          "Stage Change", `D-${d.id}`, cn,
          `Moved to ${safeStr(d.stage)}${d.lostReason ? ` — ${safeStr(d.lostReason)}` : ""}`,
          safeDate(d.completedAt),
        ]);
      }
    }
    for (const a of dealActivities) {
      const c = mapGet(contactMap, a.contactId);
      timelineRows.push([
        "Activity", `D-${a.dealId}`, safeStr(c?.name),
        `${safeStr(a.type)}: ${safeStr(a.callStatus)}`, safeDate(a.createdAt),
      ]);
    }
    timelineRows.sort((a, b) => {
      const da = a[4] instanceof Date ? a[4].getTime() : 0;
      const db2 = b[4] instanceof Date ? b[4].getTime() : 0;
      return db2 - da;
    });

    const sheets: SheetDef[] = [
      { name: "Deals", headers: dealHeaders, rows: dealRows },
      { name: "Activities", headers: actHeaders, rows: actRows },
      { name: "Timeline", headers: timelineHeaders, rows: timelineRows },
    ];
    const wb = buildWorkbook(sheets, `Deals (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("deals-detailed"), format);
  } catch (err: any) {
    console.error("[exports/deals]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 4. GET /exports/activities ──────────────────────────────────────────────
router.get("/activities", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, status, search } = parseQueryParams(req);

    const actConditions: SQL[] = [];
    if (user.role === "sales") actConditions.push(eq(activitiesTable.createdBy, user.id));

    const allActivities = actConditions.length
      ? await db.select().from(activitiesTable).where(and(...actConditions))
      : await db.select().from(activitiesTable);

    let filtered = allActivities.filter(a => matchesDateRange(a.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(a => a.assignedTo === ownerId || a.createdBy === ownerId);
    if (status) filtered = filtered.filter(a => a.callStatus === status);

    const contacts = await db.select().from(contactsTable);
    const users = await db.select().from(usersTable);
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(a => {
        const c = mapGet(contactMap, a.contactId);
        return (
          matchesSearch(c?.name, search) ||
          matchesSearch(c?.companyName, search) ||
          matchesSearch(a.notes, search) ||
          matchesSearch(a.type, search)
        );
      });
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Deal #", "Customer", "Sales Owner", "Support Owner",
        "Type", "Priority", "Status", "Created Date", "Next Follow-up", "Remarks",
      ];
      const rows = filtered.map(a => {
        const c = mapGet(contactMap, a.contactId);
        const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
        return [
          `A-${a.id}`,
          `D-${a.dealId}`,
          safeStr(c?.name),
          safeStr(assignee?.name),
          "",
          safeStr(a.type),
          safeStr(a.priority),
          safeStr(a.callStatus),
          safeDate(a.createdAt),
          safeStr(a.followUpDate),
          safeStr(a.notes),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Activities", headers, rows }];
      const wb = buildWorkbook(sheets, `Activities — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("activities"), format);
      return;
    }

    // ── Detailed: 2 sheets ──────────────────────────────────────────────
    const detailHeaders = [
      "ID", "Deal #", "Customer", "Company", "Type", "Status",
      "Priority", "Follow-up Date", "Follow-up Time", "Follow-up Type",
      "Reminder", "Notes", "Assigned To", "Created By",
      "Is Edited", "Created", "Updated",
    ];
    const detailRows = filtered.map(a => {
      const c = mapGet(contactMap, a.contactId);
      const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
      const creator = a.createdBy ? userMap.get(a.createdBy) : null;
      return [
        `A-${a.id}`,
        `D-${a.dealId}`,
        safeStr(c?.name),
        safeStr(c?.companyName),
        safeStr(a.type),
        safeStr(a.callStatus),
        safeStr(a.priority),
        safeStr(a.followUpDate),
        safeStr(a.followUpTime),
        safeStr(a.followUpType),
        safeStr(a.reminder),
        safeStr(a.notes),
        safeStr(assignee?.name),
        safeStr(creator?.name),
        a.isEdited ? "Yes" : "No",
        safeDate(a.createdAt),
        safeDate(a.updatedAt),
      ];
    });

    const historyHeaders = ["Event", "Activity ID", "Deal #", "Customer", "Description", "Date"];
    const historyRows: any[][] = [];
    for (const a of filtered) {
      const c = mapGet(contactMap, a.contactId);
      const cn = safeStr(c?.name);
      historyRows.push([
        "Created", `A-${a.id}`, `D-${a.dealId}`, cn,
        `${safeStr(a.type)} scheduled for ${safeStr(a.followUpDate)}`, safeDate(a.createdAt),
      ]);
      if (a.updatedAt && a.isEdited) {
        historyRows.push([
          "Edited", `A-${a.id}`, `D-${a.dealId}`, cn,
          `Status: ${safeStr(a.callStatus)}`, safeDate(a.updatedAt),
        ]);
      }
    }
    historyRows.sort((a, b) => {
      const da = a[5] instanceof Date ? a[5].getTime() : 0;
      const db2 = b[5] instanceof Date ? b[5].getTime() : 0;
      return db2 - da;
    });

    const sheets: SheetDef[] = [
      { name: "Follow-up Details", headers: detailHeaders, rows: detailRows },
      { name: "History", headers: historyHeaders, rows: historyRows },
    ];
    const wb = buildWorkbook(sheets, `Activities (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("activities-detailed"), format);
  } catch (err: any) {
    console.error("[exports/activities]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 5. GET /exports/existing-customers ──────────────────────────────────────
router.get("/existing-customers", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, status, search } = parseQueryParams(req);

    const ecConditions: SQL[] = [];
    if (user.role === "support") ecConditions.push(eq(existingCustomersTable.supportOwnerId, user.id));

    const ecList = ecConditions.length
      ? await db.select().from(existingCustomersTable).where(and(...ecConditions))
      : await db.select().from(existingCustomersTable);

    let filtered = ecList.filter(ec => matchesDateRange(ec.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(ec => ec.salesOwnerId === ownerId || ec.supportOwnerId === ownerId);
    if (status) filtered = filtered.filter(ec => ec.status === status);

    const ecContactIds = nonNullIds(filtered.map(ec => ec.contactId));
    const contacts = ecContactIds.length
      ? await db.select().from(contactsTable).where(inArray(contactsTable.id, ecContactIds))
      : await db.select().from(contactsTable);
    const ecContactMap = new Map(contacts.map(c => [c.id, c]));

    if (search) {
      filtered = filtered.filter(ec => {
        const c = ecContactMap.get(ec.contactId);
        return (
          matchesSearch(c?.name, search) ||
          matchesSearch(c?.companyName, search) ||
          matchesSearch(c?.mobile, search) ||
          matchesSearch(c?.email, search) ||
          matchesSearch(ec.lastProductName, search)
        );
      });
    }

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Name", "Company", "Mobile", "City", "Status",
        "Total Orders", "Total Revenue", "Repeat Orders", "Sales Owner",
        "Support Owner", "Last Order Date", "Created",
      ];
      const rows = filtered.map(ec => {
        const c = ecContactMap.get(ec.contactId);
        const salesOwner = ec.salesOwnerId ? userMap.get(ec.salesOwnerId) : null;
        const supportOwner = ec.supportOwnerId ? userMap.get(ec.supportOwnerId) : null;
        return [
          `EC-${ec.id}`,
          safeStr(c?.name),
          safeStr(c?.companyName),
          safeStr(c?.mobile),
          safeStr(c?.city),
          safeStr(ec.status),
          safeNum(ec.totalOrders),
          safeNum(ec.totalRevenue),
          safeNum(ec.repeatOrderCount),
          safeStr(salesOwner?.name),
          safeStr(supportOwner?.name),
          safeStr(ec.lastOrderDate),
          safeDate(ec.createdAt),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Existing Customers", headers, rows }];
      const wb = buildWorkbook(sheets, `Existing Customers — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("existing-customers"), format);
      return;
    }

    // ── Detailed: 5 sheets ──────────────────────────────────────────────
    const profileHeaders = [
      "ID", "Name", "Company", "Mobile", "Email", "City",
      "Status", "Total Orders", "Total Revenue", "Repeat Orders",
      "First Order Date", "Last Order Date", "Last Product",
      "Production Status", "Dispatch Status", "Active Complaint",
      "Sales Owner", "Support Owner", "Created",
    ];
    const profileRows = filtered.map(ec => {
      const c = ecContactMap.get(ec.contactId);
      const salesOwner = ec.salesOwnerId ? userMap.get(ec.salesOwnerId) : null;
      const supportOwner = ec.supportOwnerId ? userMap.get(ec.supportOwnerId) : null;
      return [
        `EC-${ec.id}`,
        safeStr(c?.name),
        safeStr(c?.companyName),
        safeStr(c?.mobile),
        safeStr(c?.email),
        safeStr(c?.city),
        safeStr(ec.status),
        safeNum(ec.totalOrders),
        safeNum(ec.totalRevenue),
        safeNum(ec.repeatOrderCount),
        safeStr(ec.firstOrderDate),
        safeStr(ec.lastOrderDate),
        safeStr(ec.lastProductName),
        safeStr(ec.currentProductionStatus),
        safeStr(ec.currentDispatchStatus),
        safeStr(ec.activeComplaintNumber),
        safeStr(salesOwner?.name),
        safeStr(supportOwner?.name),
        safeDate(ec.createdAt),
      ];
    });

    const validContactIds = nonNullIds(filtered.map(ec => ec.contactId));
    const orders = validContactIds.length
      ? await db.select().from(ordersTable).where(inArray(ordersTable.contactId, validContactIds))
      : [];
    const orderHeaders = [
      "Order #", "Customer", "Company", "Status", "Grand Total", "Created",
    ];
    const orderRows = orders.map(o => [
      safeStr(o.orderNumber),
      safeStr(o.customerName),
      safeStr(o.companyName),
      safeStr(o.status),
      safeNum(o.grandTotal),
      safeDate(o.createdAt),
    ]);

    const repeatOrders = orders.filter(o => o.isRepeatOrder);
    const repeatHeaders = [
      "Order #", "Customer", "Status", "Grand Total", "Previous Order #", "Created",
    ];
    const repeatRows = repeatOrders.map(o => [
      safeStr(o.orderNumber),
      safeStr(o.customerName),
      safeStr(o.status),
      safeNum(o.grandTotal),
      o.previousOrderId ? `ORD-${o.previousOrderId}` : "",
      safeDate(o.createdAt),
    ]);

    const complaints = validContactIds.length
      ? await db.select().from(complaintsTable).where(inArray(complaintsTable.contactId, validContactIds))
      : [];
    const compHeaders = [
      "Complaint #", "Customer", "Product", "Type", "Priority", "Status",
      "Description", "Resolution", "Created",
    ];
    const compRows = complaints.map(cm => [
      safeStr(cm.complaintNumber),
      safeStr(cm.customerName),
      safeStr(cm.productName),
      safeStr(cm.complaintType),
      safeStr(cm.priority),
      safeStr(cm.status),
      safeStr(cm.description),
      safeStr(cm.resolution),
      safeDate(cm.createdAt),
    ]);

    const comms = validContactIds.length
      ? await db.select().from(customerCommunicationsTable).where(inArray(customerCommunicationsTable.contactId, validContactIds))
      : [];
    const commHeaders = [
      "ID", "Type", "Direction", "Notes", "Next Action",
      "Next Action Date", "Created By", "Department", "Created",
    ];
    const commRows = comms.map(cm => {
      const creator = cm.createdBy ? userMap.get(cm.createdBy) : null;
      return [
        `COM-${cm.id}`,
        safeStr(cm.type),
        safeStr(cm.direction),
        safeStr(cm.notes),
        safeStr(cm.nextAction),
        safeStr(cm.nextActionDate),
        safeStr(creator?.name),
        safeStr(cm.department),
        safeDate(cm.createdAt),
      ];
    });

    const sheets: SheetDef[] = [
      { name: "Customer Profile", headers: profileHeaders, rows: profileRows },
      { name: "Order History", headers: orderHeaders, rows: orderRows },
      { name: "Repeat Orders", headers: repeatHeaders, rows: repeatRows },
      { name: "Complaint History", headers: compHeaders, rows: compRows },
      { name: "Communication History", headers: commHeaders, rows: commRows },
    ];
    const wb = buildWorkbook(sheets, `Existing Customers (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("existing-customers-detailed"), format);
  } catch (err: any) {
    console.error("[exports/existing-customers]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 6. GET /exports/production ──────────────────────────────────────────────
router.get("/production", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, status, search } = parseQueryParams(req);

    const prodConditions: SQL[] = [];
    if (user.role === "production_manager") {
      prodConditions.push(eq(productionOrdersTable.assignedProductionManagerId, user.id));
    }

    const prodOrders = prodConditions.length
      ? await db.select().from(productionOrdersTable).where(and(...prodConditions))
      : await db.select().from(productionOrdersTable);

    let filtered = prodOrders.filter(po => matchesDateRange(po.createdAt, dateFrom, dateTo));
    if (status) filtered = filtered.filter(po => po.status === status);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(po => {
        const mgr = po.assignedProductionManagerId ? userMap.get(po.assignedProductionManagerId) : null;
        return (
          matchesSearch(mgr?.name, search) ||
          matchesSearch(po.status, search) ||
          matchesSearch(po.priority, search)
        );
      });
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Invoice #", "Status", "Priority", "Expected Dispatch",
        "Assigned Manager", "Created", "Updated",
      ];
      const rows = filtered.map(po => {
        const mgr = po.assignedProductionManagerId ? userMap.get(po.assignedProductionManagerId) : null;
        return [
          `PO-${po.id}`,
          `PI-${po.proformaInvoiceId}`,
          safeStr(po.status),
          safeStr(po.priority),
          safeStr(po.expectedDispatchDate),
          safeStr(mgr?.name),
          safeDate(po.createdAt),
          safeDate(po.updatedAt),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Production Orders", headers, rows }];
      const wb = buildWorkbook(sheets, `Production Orders — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("production"), format);
      return;
    }

    // ── Detailed: 3 sheets ──────────────────────────────────────────────
    const detailHeaders = [
      "ID", "Invoice #", "Status", "Priority", "Expected Dispatch Date", "QC Status",
      "Assigned Manager", "Notes", "Created", "Updated",
    ];
    const detailRows = filtered.map(po => {
      const mgr = po.assignedProductionManagerId ? userMap.get(po.assignedProductionManagerId) : null;
      return [
        `PO-${po.id}`,
        `PI-${po.proformaInvoiceId}`,
        safeStr(po.status),
        safeStr(po.priority),
        safeStr(po.expectedDispatchDate),
        "",
        safeStr(mgr?.name),
        "", // notes live in productionNotesTable, fetched in timeline
        safeDate(po.createdAt),
        safeDate(po.updatedAt),
      ];
    });

    let batchHeaders: string[] = ["Info"];
    let batchRows: any[][] = [["Batch data loading..."]];
    try {
      const batches = await db.select().from(productionBatchesTable);
      batchHeaders = [
        "Batch #", "Product", "Total Qty", "Completed Qty", "Rejected Qty",
        "Status", "Priority", "Machine", "Operator", "Progress %",
        "Expected Completion", "Actual Completion", "Notes", "Created",
      ];
      batchRows = batches.map(b => [
        safeStr(b.batchNumber),
        safeStr(b.productName),
        safeNum(b.totalQuantity),
        safeNum(b.completedQuantity),
        safeNum(b.rejectedQuantity),
        safeStr(b.status),
        safeStr(b.priority),
        safeStr(b.machine),
        safeStr(b.operator),
        safeNum(b.progress),
        safeStr(b.expectedCompletionDate),
        safeStr(b.actualCompletionDate),
        safeStr(b.notes),
        safeDate(b.createdAt),
      ]);
    } catch {
      // production_batches table may not exist yet
      batchHeaders = ["Info"];
      batchRows = [["Batch data not available"]];
    }

    const prodIds = nonNullIds(filtered.map(po => po.id));
    const timeline = prodIds.length
      ? await db.select().from(productionTimelineTable).where(inArray(productionTimelineTable.productionOrderId, prodIds))
      : [];
    const timelineHeaders = ["ID", "Order #", "Status", "Notes", "Created By", "Created"];
    const timelineRows = timeline.map(t => {
      const creator = t.createdBy ? userMap.get(t.createdBy) : null;
      return [
        `PT-${t.id}`,
        `PO-${t.productionOrderId}`,
        safeStr(t.status),
        safeStr(t.notes),
        safeStr(creator?.name),
        safeDate(t.createdAt),
      ];
    });

    const sheets: SheetDef[] = [
      { name: "Production Orders", headers: detailHeaders, rows: detailRows },
      { name: "Batch Details", headers: batchHeaders, rows: batchRows },
      { name: "Timeline", headers: timelineHeaders, rows: timelineRows },
    ];
    const wb = buildWorkbook(sheets, `Production (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("production-detailed"), format);
  } catch (err: any) {
    console.error("[exports/production]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 7. GET /exports/dispatch ────────────────────────────────────────────────
router.get("/dispatch", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, status, search } = parseQueryParams(req);

    let dispatchList = await db.select().from(dispatchTable);
    let filtered = dispatchList.filter(d => matchesDateRange(d.createdAt, dateFrom, dateTo));
    if (status) filtered = filtered.filter(d => d.status === status);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(d =>
        matchesSearch(d.dispatchNumber, search) ||
        matchesSearch(d.vehicleNumber, search) ||
        matchesSearch(d.transportCompany, search) ||
        matchesSearch(d.lrNumber, search) ||
        matchesSearch(d.remarks, search)
      );
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const dispatchOrderIds = nonNullIds(filtered.map(d => d.orderId));
      const dispatchOrdersMap = new Map<number, any>();
      if (dispatchOrderIds.length) {
        const dispatchOrders = await db.select().from(ordersTable).where(inArray(ordersTable.id, dispatchOrderIds));
        dispatchOrders.forEach(o => dispatchOrdersMap.set(o.id, o));
      }

      const headers = [
        "ID", "Dispatch #", "Order #", "Customer", "Vehicle", "Transport",
        "LR Number", "Dispatch Date", "Delivery Date", "Status",
      ];
      const rows = filtered.map(d => [
        `DSP-${d.id}`,
        safeStr(d.dispatchNumber),
        `ORD-${d.orderId}`,
        safeStr(dispatchOrdersMap.get(d.orderId)?.customerName || ""),
        safeStr(d.vehicleNumber),
        safeStr(d.transportCompany),
        safeStr(d.lrNumber),
        safeStr(d.dispatchDate),
        safeStr(d.deliveredDate),
        safeStr(d.status),
      ]);

      const sheets: SheetDef[] = [{ name: "Dispatch", headers, rows }];
      const wb = buildWorkbook(sheets, `Dispatch — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("dispatch"), format);
      return;
    }

    // ── Detailed: 2 sheets ──────────────────────────────────────────────
    const detailOrderIds = nonNullIds(filtered.map(d => d.orderId));
    const detailOrdersMap = new Map<number, any>();
    if (detailOrderIds.length) {
      const detailOrders = await db.select().from(ordersTable).where(inArray(ordersTable.id, detailOrderIds));
      detailOrders.forEach(o => detailOrdersMap.set(o.id, o));
    }

    const detailHeaders = [
      "ID", "Dispatch #", "Order #", "Customer", "Status", "Vehicle #",
      "Driver Name", "Driver Mobile", "Transport Company",
      "LR Number", "Tracking #", "Dispatch Date", "Expected Delivery",
      "Delivered Date", "Dispatch Address", "Freight", "Remarks",
      "Handled By", "Created",
    ];
    const detailRows = filtered.map(d => {
      const handler = d.dispatchHandledBy ? userMap.get(d.dispatchHandledBy) : null;
      return [
        `DSP-${d.id}`,
        safeStr(d.dispatchNumber),
        `ORD-${d.orderId}`,
        safeStr(detailOrdersMap.get(d.orderId)?.customerName || ""),
        safeStr(d.status),
        safeStr(d.vehicleNumber),
        safeStr(d.driverName),
        safeStr(d.driverMobile),
        safeStr(d.transportCompany),
        safeStr(d.lrNumber),
        safeStr(d.trackingNumber),
        safeStr(d.dispatchDate),
        safeStr(d.expectedDeliveryDate),
        safeStr(d.deliveredDate),
        safeStr(d.dispatchAddress),
        safeNum(d.freight),
        safeStr(d.remarks),
        safeStr(handler?.name),
        safeDate(d.createdAt),
      ];
    });

    const dispatchIds = nonNullIds(filtered.map(d => d.id));
    const items = dispatchIds.length
      ? await db.select().from(dispatchItemsTable).where(inArray(dispatchItemsTable.dispatchId, dispatchIds))
      : [];
    const itemHeaders = ["Dispatch #", "Product", "Quantity", "Batch #", "Remarks"];
    const itemRows = items.map(di => [
      `DSP-${di.dispatchId}`,
      safeStr(di.productName),
      safeNum(di.quantity),
      safeStr(di.batchNumber),
      safeStr(di.remarks),
    ]);

    const sheets: SheetDef[] = [
      { name: "Dispatch", headers: detailHeaders, rows: detailRows },
      { name: "Dispatch Items", headers: itemHeaders, rows: itemRows },
    ];
    const wb = buildWorkbook(sheets, `Dispatch (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("dispatch-detailed"), format);
  } catch (err: any) {
    console.error("[exports/dispatch]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 8. GET /exports/complaints ──────────────────────────────────────────────
router.get("/complaints", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, status, search } = parseQueryParams(req);

    const compConditions: SQL[] = [];
    if (user.role === "sales") compConditions.push(eq(complaintsTable.createdBy, user.id));
    if (user.role === "production_manager") compConditions.push(eq(complaintsTable.assignedTo, user.id));

    const complaintsList = compConditions.length
      ? await db.select().from(complaintsTable).where(and(...compConditions))
      : await db.select().from(complaintsTable);

    let filtered = complaintsList.filter(c => matchesDateRange(c.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(c => c.assignedTo === ownerId);
    if (status) filtered = filtered.filter(c => c.status === status);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(c =>
        matchesSearch(c.complaintNumber, search) ||
        matchesSearch(c.customerName, search) ||
        matchesSearch(c.productName, search) ||
        matchesSearch(c.description, search) ||
        matchesSearch(c.resolution, search)
      );
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Complaint #", "Customer", "Order", "Product", "Priority",
        "Status", "Assigned User", "Resolution", "Created",
      ];
      const rows = filtered.map(c => {
        const assignee = c.assignedTo ? userMap.get(c.assignedTo) : null;
        return [
          `CMP-${c.id}`,
          safeStr(c.complaintNumber),
          safeStr(c.customerName),
          c.orderId ? `ORD-${c.orderId}` : "",
          safeStr(c.productName),
          safeStr(c.priority),
          safeStr(c.status),
          safeStr(assignee?.name),
          safeStr(c.resolution),
          safeDate(c.createdAt),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Complaints", headers, rows }];
      const wb = buildWorkbook(sheets, `Complaints — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("complaints"), format);
      return;
    }

    // ── Detailed: 2 sheets ──────────────────────────────────────────────
    const detailHeaders = [
      "ID", "Complaint #", "Customer", "Order #", "Product",
      "Quantity", "Type", "Priority", "Status", "Department",
      "Description", "Assigned To", "Resolution", "Replacement Order",
      "Closed At", "Created By", "Created", "Updated",
    ];
    const detailRows = filtered.map(c => {
      const assignee = c.assignedTo ? userMap.get(c.assignedTo) : null;
      const creator = c.createdBy ? userMap.get(c.createdBy) : null;
      return [
        `CMP-${c.id}`,
        safeStr(c.complaintNumber),
        safeStr(c.customerName),
        c.orderId ? `ORD-${c.orderId}` : "",
        safeStr(c.productName),
        safeNum(c.quantity),
        safeStr(c.complaintType),
        safeStr(c.priority),
        safeStr(c.status),
        safeStr(c.assignedDepartment),
        safeStr(c.description),
        safeStr(assignee?.name),
        safeStr(c.resolution),
        safeStr(c.replacementOrderId ? `ORD-${c.replacementOrderId}` : ""),
        safeDate(c.closedAt),
        safeStr(creator?.name),
        safeDate(c.createdAt),
        safeDate(c.updatedAt),
      ];
    });

    const complaintIds = nonNullIds(filtered.map(c => c.id));
    const updates = complaintIds.length
      ? await db.select().from(complaintUpdatesTable).where(inArray(complaintUpdatesTable.complaintId, complaintIds))
      : [];
    const timelineHeaders = ["Complaint #", "Status From", "Status To", "Notes", "Changed By", "Date"];
    const timelineRows = updates.map(u => {
      const changer = userMap.get(u.changedBy);
      return [
        `CMP-${u.complaintId}`,
        safeStr(u.statusFrom),
        safeStr(u.statusTo),
        safeStr(u.notes),
        safeStr(changer?.name),
        safeDate(u.createdAt),
      ];
    });

    const sheets: SheetDef[] = [
      { name: "Complaint Details", headers: detailHeaders, rows: detailRows },
      { name: "Timeline", headers: timelineHeaders, rows: timelineRows },
    ];
    const wb = buildWorkbook(sheets, `Complaints (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("complaints-detailed"), format);
  } catch (err: any) {
    console.error("[exports/complaints]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 9. GET /exports/orders ──────────────────────────────────────────────────
router.get("/orders", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, status, search } = parseQueryParams(req);

    const orderConditions: SQL[] = [];
    if (user.role === "sales") orderConditions.push(eq(ordersTable.salesOwnerId, user.id));

    const allOrders = orderConditions.length
      ? await db.select().from(ordersTable).where(and(...orderConditions))
      : await db.select().from(ordersTable);

    let filtered = allOrders.filter(o => matchesDateRange(o.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(o => o.salesOwnerId === ownerId || o.supportOwnerId === ownerId);
    if (status) filtered = filtered.filter(o => o.status === status);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    if (search) {
      filtered = filtered.filter(o =>
        matchesSearch(o.orderNumber, search) ||
        matchesSearch(o.customerName, search) ||
        matchesSearch(o.companyName, search) ||
        matchesSearch(o.remarks, search)
      );
    }

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "Order #", "Customer", "Sales Owner", "Support Owner", "Status",
        "Order Date", "Grand Total", "GST", "Production Status",
        "Dispatch Status", "Payment Status", "Remarks",
      ];
      const rows = filtered.map(o => {
        const salesOwner = o.salesOwnerId ? userMap.get(o.salesOwnerId) : null;
        const supportOwner = o.supportOwnerId ? userMap.get(o.supportOwnerId) : null;
        return [
          safeStr(o.orderNumber),
          safeStr(o.customerName),
          safeStr(salesOwner?.name),
          safeStr(supportOwner?.name),
          safeStr(o.status),
          safeDate(o.createdAt),
          safeNum(o.grandTotal),
          safeStr(o.gstNumber || ""),
          "",
          "",
          "",
          safeStr(o.remarks),
        ];
      });

      const sheets: SheetDef[] = [{ name: "Orders", headers, rows }];
      const wb = buildWorkbook(sheets, `Orders — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("orders"), format);
      return;
    }

    // ── Detailed: 2 sheets ──────────────────────────────────────────────
    const detailHeaders = [
      "Order #", "Customer", "Company", "Sales Owner", "Support Owner",
      "Status", "Order Date", "Grand Total", "GST", "GST Number",
      "Production Status", "Dispatch Status", "Payment Status",
      "Payment Terms", "Delivery Terms", "Remarks", "Created",
    ];
    const detailRows = filtered.map(o => {
      const salesOwner = o.salesOwnerId ? userMap.get(o.salesOwnerId) : null;
      const supportOwner = o.supportOwnerId ? userMap.get(o.supportOwnerId) : null;
      return [
        safeStr(o.orderNumber),
        safeStr(o.customerName),
        safeStr(o.companyName),
        safeStr(salesOwner?.name),
        safeStr(supportOwner?.name),
        safeStr(o.status),
        safeDate(o.createdAt),
        safeNum(o.grandTotal),
        safeStr(o.totalGst ? `${o.totalGst}` : ""),
        safeStr(o.gstNumber || ""),
        "",
        "",
        "",
        safeStr(o.paymentTerms || ""),
        safeStr(o.deliveryTerms || ""),
        safeStr(o.remarks),
        safeDate(o.createdAt),
      ];
    });

    const orderIds = nonNullIds(filtered.map(o => o.id));
    const items = orderIds.length
      ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds))
      : [];
    const itemHeaders = [
      "Order #", "Product", "Bottle", "Capacity", "Weight", "Cap", "Color",
      "Quantity", "Rate", "Amount", "Production Status", "Batch",
    ];
    const itemRows = items.map(item => {
      const o = filtered.find(ord => ord.id === item.orderId);
      return [
        safeStr(o?.orderNumber || ""),
        safeStr(item.productName),
        safeStr(item.bottleType),
        safeStr(item.capacity),
        safeNum(item.bottleWeight),
        safeStr(item.capColour),
        safeStr(item.colour),
        safeNum(item.quantity),
        safeNum(item.rate),
        safeNum(item.amount),
        safeStr(item.status),
        safeStr(item.batchNumber),
      ];
    });

    const sheets: SheetDef[] = [
      { name: "Orders", headers: detailHeaders, rows: detailRows },
      { name: "Order Items", headers: itemHeaders, rows: itemRows },
    ];
    const wb = buildWorkbook(sheets, `Orders (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("orders-detailed"), format);
  } catch (err: any) {
    console.error("[exports/orders]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

// ─── 10. GET /exports/leads ─────────────────────────────────────────────────
router.get("/leads", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { format, mode, dateFrom, dateTo, ownerId, status } = parseQueryParams(req);

    const leadConditions: SQL[] = [];
    if (user.role === "sales") leadConditions.push(eq(contactsTable.salesOwnerId, user.id));

    const leads = leadConditions.length
      ? await db.select().from(contactsTable).where(and(...leadConditions))
      : await db.select().from(contactsTable);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u]));

    let filtered = leads.filter(l => matchesDateRange(l.createdAt, dateFrom, dateTo));
    if (ownerId) filtered = filtered.filter(l => l.salesOwnerId === ownerId);
    if (status) filtered = filtered.filter(l => l.category === status);

    // ── Quick ───────────────────────────────────────────────────────────
    if (mode === "quick") {
      const headers = [
        "ID", "Name", "Company", "Mobile", "Email", "City",
        "Industry", "Unit", "Category", "Owner", "Created",
      ];
      const rows = filtered.map(l => {
        const owner = l.salesOwnerId ? userMap.get(l.salesOwnerId) : null;
        return [
          `L-${l.id}`, safeStr(l.name), safeStr(l.companyName),
          safeStr(l.mobile), safeStr(l.email), safeStr(l.city),
          safeStr(l.industry), safeStr(l.unit), safeStr(l.category),
          safeStr(owner?.name), safeDate(l.createdAt),
        ];
      });
      const sheets: SheetDef[] = [{ name: "Leads", headers, rows }];
      const wb = buildWorkbook(sheets, `Leads — ${todayStr()}`);
      await sendWorkbook(res, wb, csvFilename("leads"), format);
      return;
    }

    // ── Detailed ────────────────────────────────────────────────────────
    const contactsMapForLeads = new Map(filtered.map(l => [l.id, l]));

    const leadIds = nonNullIds(filtered.map(l => l.id));
    const dealLeads = leadIds.length
      ? await db.select().from(dealsTable).where(inArray(dealsTable.contactId, leadIds))
      : [];
    const dealMap = new Map<number, any[]>();
    dealLeads.forEach(dl => {
      const arr = dealMap.get(dl.contactId) || [];
      arr.push(dl);
      dealMap.set(dl.contactId, arr);
    });

    const leadActivityConditions: SQL[] = [];
    if (leadIds.length) leadActivityConditions.push(inArray(activitiesTable.contactId, leadIds));
    const leadActivities = leadActivityConditions.length
      ? await db.select().from(activitiesTable).where(and(...leadActivityConditions))
      : [];

    const detailHeaders = [
      "ID", "Name", "Company", "Mobile", "Email", "City", "State",
      "Industry", "Unit", "Category", "Lead Source", "Owner",
      "Customer Since", "Status", "Created",
    ];
    const detailRows = filtered.map(l => {
      const owner = l.salesOwnerId ? userMap.get(l.salesOwnerId) : null;
      return [
        `L-${l.id}`, safeStr(l.name), safeStr(l.companyName),
        safeStr(l.mobile), safeStr(l.email), safeStr(l.city),
        safeStr(l.state), safeStr(l.industry), safeStr(l.unit),
        safeStr(l.category), safeStr(l.leadSource),
        safeStr(owner?.name), safeStr(l.customerSince),
        safeStr(l.customerStatus), safeDate(l.createdAt),
      ];
    });

    const actHeaders = [
      "Activity ID", "Lead", "Type", "Status", "Follow-up Date",
      "Notes", "Assigned To", "Created",
    ];
    const actRows = leadActivities.map(a => {
      const lc = a.contactId != null ? contactsMapForLeads.get(a.contactId) : undefined;
      const assignee = a.assignedTo ? userMap.get(a.assignedTo) : null;
      return [
        `A-${a.id}`, safeStr(lc?.name), safeStr(a.type),
        safeStr(a.callStatus), safeStr(a.followUpDate),
        safeStr(a.notes), safeStr(assignee?.name), safeDate(a.createdAt),
      ];
    });

    // Timeline
    const timelineHeaders = ["Date", "Event", "Lead", "Details"];
    const timelineRows: any[][] = [];
    for (const l of filtered) {
      timelineRows.push(["Lead Created", `L-${l.id}`, safeStr(l.name), safeDate(l.createdAt)]);
    }
    for (const a of leadActivities) {
      const lc = a.contactId != null ? contactsMapForLeads.get(a.contactId) : undefined;
      timelineRows.push([safeDate(a.createdAt), "Activity", safeStr(lc?.name), `${safeStr(a.type)} - ${safeStr(a.callStatus)}`]);
    }
    timelineRows.sort((a, b) => {
      const da = a[0] instanceof Date ? a[0].getTime() : 0;
      const db2 = b[0] instanceof Date ? b[0].getTime() : 0;
      return db2 - da;
    });

    const sheets: SheetDef[] = [
      { name: "Lead Details", headers: detailHeaders, rows: detailRows },
      { name: "Activities", headers: actHeaders, rows: actRows },
      { name: "Timeline", headers: timelineHeaders, rows: timelineRows },
    ];
    const wb = buildWorkbook(sheets, `Leads (Detailed) — ${todayStr()}`);
    await sendWorkbook(res, wb, csvFilename("leads-detailed"), format);
  } catch (err: any) {
    console.error("[exports/leads]", err);
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

export default router;
