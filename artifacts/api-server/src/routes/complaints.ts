import { Router, type IRouter } from "express";
import { db, complaintsTable, complaintUpdatesTable, contactsTable, usersTable, ordersTable } from "@workspace/db";
import { eq, and, or, desc, sql, ilike } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";
import { logAudit } from "../middlewares/auth";
import { getAccessibleUnits } from "../lib/unit-filter";

const router: IRouter = Router();

async function enrichComplaint(c: any) {
  const updates = await db.select({
    id: complaintUpdatesTable.id,
    statusFrom: complaintUpdatesTable.statusFrom,
    statusTo: complaintUpdatesTable.statusTo,
    notes: complaintUpdatesTable.notes,
    changedBy: usersTable.name,
    createdAt: complaintUpdatesTable.createdAt,
  }).from(complaintUpdatesTable)
    .leftJoin(usersTable, eq(usersTable.id, complaintUpdatesTable.changedBy))
    .where(eq(complaintUpdatesTable.complaintId, c.id))
    .orderBy(desc(complaintUpdatesTable.createdAt));

  const assignee = c.assignedTo ? await db.select().from(usersTable).where(eq(usersTable.id, c.assignedTo)).then(r => r[0]) : null;
  const creator = c.createdBy ? await db.select().from(usersTable).where(eq(usersTable.id, c.createdBy)).then(r => r[0]) : null;
  const resolver = c.resolvedBy ? await db.select().from(usersTable).where(eq(usersTable.id, c.resolvedBy)).then(r => r[0]) : null;
  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;

  return { ...c, updates, assignee: safe(assignee), creator: safe(creator), resolver: safe(resolver) };
}

// List complaints — enhanced search by customer name, company, mobile, complaint number
router.get("/complaints", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Inventory users are read-only
    if (user.role === "inventory") {
      const { status, search, assignedTo, page = "1", limit = "50" } = req.query as Record<string, string>;
      const conditions: any[] = [eq(complaintsTable.isDeleted, false)];
      if (status && status !== "All") conditions.push(eq(complaintsTable.status, status));
      if (search) {
        const s = `%${search}%`;
        conditions.push(or(
          ilike(complaintsTable.complaintNumber, s),
          ilike(complaintsTable.customerName, s),
        )!);
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(complaintsTable).where(where);
      const complaints = await db.select().from(complaintsTable).where(where).orderBy(desc(complaintsTable.createdAt)).limit(limitNum).offset((pageNum - 1) * limitNum);
      const enriched = await Promise.all(complaints.map(enrichComplaint));
      res.json({ data: enriched, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
      return;
    }

    const { status, search, assignedTo, priority, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [eq(complaintsTable.isDeleted, false)];

    // Role-based filtering
    if (user.role === "production") {
      // Production sees only assigned to them
      conditions.push(eq(complaintsTable.assignedTo, user.id));
    }

    if (status && status !== "All") conditions.push(eq(complaintsTable.status, status));
    if (assignedTo) conditions.push(eq(complaintsTable.assignedTo, Number(assignedTo)));
    if (priority) conditions.push(eq(complaintsTable.priority, priority));

    // Enhanced search: join contacts for company + secondary mobile
    if (search) {
      const s = `%${search}%`;
      conditions.push(or(
        ilike(complaintsTable.complaintNumber, s),
        ilike(complaintsTable.customerName, s),
        ilike(complaintsTable.productName, s),
        sql`EXISTS (SELECT 1 FROM contacts c WHERE c.id = ${complaintsTable.contactId} AND (c.company_name ILIKE ${s} OR c.other_phone ILIKE ${s}))`,
      )!);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(complaintsTable).where(where);
    const complaints = await db.select().from(complaintsTable).where(where).orderBy(desc(complaintsTable.createdAt)).limit(limitNum).offset((pageNum - 1) * limitNum);
    const enriched = await Promise.all(complaints.map(enrichComplaint));

    res.json({ data: enriched, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
  } catch (err) {
    console.error("List complaints error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single complaint
router.get("/complaints/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [c] = await db.select().from(complaintsTable).where(eq(complaintsTable.id, Number(req.params.id)));
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichComplaint(c));
  } catch (err) {
    console.error("Get complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create complaint — with audit trail + enhanced notifications
router.post("/complaints", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Inventory users cannot create complaints
    if (user.role === "inventory") {
      res.status(403).json({ error: "Inventory users cannot create complaints" });
      return;
    }

    const complaintNumber = await generateId("complaint");
    const [complaint] = await db.insert(complaintsTable).values({
      ...req.body,
      complaintNumber,
      createdBy: user.id,
    }).returning();

    // Audit trail
    await logAudit("complaint", complaint.id, "created", null, complaint, user.id, undefined, user.role);

    // Notify admins and all support users
    const notifyUsers = await db.select({ id: usersTable.id }).from(usersTable)
      .where(or(eq(usersTable.role, "admin"), eq(usersTable.role, "production_and_support")));
    for (const u of notifyUsers) {
      if (u.id !== user.id) {
        await createNotification({
          userId: u.id, type: "complaint_created", title: "New Complaint",
          message: `Complaint ${complaintNumber} from ${complaint.customerName}\nType: ${complaint.complaintType}\nPriority: ${complaint.priority || "Medium"}`,
          link: `/complaints/${complaint.id}`, relatedId: complaint.id, relatedType: "complaint",
        });
      }
    }

    res.status(201).json(await enrichComplaint(complaint));
  } catch (err) {
    console.error("Create complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update complaint — with status tracking, root cause, resolved by/at, audit trail
router.patch("/complaints/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Inventory users are read-only
    if (user.role === "inventory") {
      res.status(403).json({ error: "Inventory users have read-only access" });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(complaintsTable).where(eq(complaintsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { status, rootCause, resolvedBy, resolvedAt, ...updateData } = req.body;

    // Track status changes
    if (status && status !== existing.status) {
      await db.insert(complaintUpdatesTable).values({
        complaintId: id,
        statusFrom: existing.status,
        statusTo: status,
        notes: req.body.resolution || req.body.updateNotes || `Status changed to ${status}`,
        changedBy: user.id,
      });

      if (status === "Closed") {
        updateData.closedAt = new Date();
        updateData.closedBy = user.id;
      }

      if (status === "Resolved") {
        updateData.resolvedAt = resolvedAt || new Date();
        updateData.resolvedBy = resolvedBy || user.id;
      }

      // Notify relevant users about status change
      const notifyUsers = new Set<number>();
      if (existing.assignedTo && existing.assignedTo !== user.id) notifyUsers.add(existing.assignedTo);
      if (existing.createdBy && existing.createdBy !== user.id) notifyUsers.add(existing.createdBy);

      const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
      for (const admin of admins) { if (admin.id !== user.id) notifyUsers.add(admin.id); }

      for (const uid of notifyUsers) {
        await createNotification({
          userId: uid, type: "complaint_status_changed", title: "Complaint Status Updated",
          message: `Complaint ${existing.complaintNumber}: ${existing.status} → ${status}\nUpdated by: ${user.name}`,
          link: `/complaints/${id}`, relatedId: id, relatedType: "complaint",
        });
      }
    }

    // Apply root cause if provided
    if (rootCause !== undefined) updateData.rootCause = rootCause;

    const [updated] = await db.update(complaintsTable).set({
      ...updateData,
      status: status || existing.status,
      updatedAt: new Date(),
    }).where(eq(complaintsTable.id, id)).returning();

    // Audit trail
    await logAudit("complaint", id, "updated", existing, updated, user.id, undefined, user.role);

    res.json(await enrichComplaint(updated));
  } catch (err) {
    console.error("Update complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete complaint (soft) — any authorized user
router.delete("/complaints/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (user.role === "inventory") {
      res.status(403).json({ error: "Inventory users cannot delete complaints" });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(complaintsTable).where(eq(complaintsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(complaintsTable).set({
      isDeleted: true, deletedAt: new Date(), deletedBy: user.id,
    }).where(eq(complaintsTable.id, id));

    await logAudit("complaint", id, "deleted", existing, null, user.id, undefined, user.role);

    res.status(204).send();
  } catch (err) {
    console.error("Delete complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
