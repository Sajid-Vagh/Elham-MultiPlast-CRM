import { Router, type IRouter } from "express";
import { db, complaintsTable, complaintUpdatesTable, contactsTable, usersTable, ordersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { generateId } from "../lib/id-generator";

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
  const safe = (u: any) => u ? (({ passwordHash: _, ...rest }) => rest)(u) : null;

  return { ...c, updates, assignee: safe(assignee), creator: safe(creator) };
}

// List complaints
router.get("/complaints", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, assignedTo, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [eq(complaintsTable.isDeleted, false)];

    if (user.role === "production_and_support") conditions.push(eq(complaintsTable.assignedTo, user.id));
    if (status && status !== "All") conditions.push(eq(complaintsTable.status, status));
    if (assignedTo) conditions.push(eq(complaintsTable.assignedTo, Number(assignedTo)));
    if (search) conditions.push(sql`${complaintsTable.complaintNumber} ILIKE ${`%${search}%`} OR ${complaintsTable.customerName} ILIKE ${`%${search}%`}`);

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

// Create complaint
router.post("/complaints", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const complaintNumber = await generateId("complaint");
    const [complaint] = await db.insert(complaintsTable).values({
      ...req.body,
      complaintNumber,
      createdBy: user.id,
    }).returning();

    // Notify admins and support
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      await createNotification({ userId: admin.id, type: "complaint_created", title: "New Complaint", message: `Complaint ${complaintNumber} from ${complaint.customerName}\nType: ${complaint.complaintType}`, link: `/complaints/${complaint.id}`, relatedId: complaint.id, relatedType: "complaint" });
    }

    res.status(201).json(await enrichComplaint(complaint));
  } catch (err) {
    console.error("Create complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update complaint
router.patch("/complaints/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [existing] = await db.select().from(complaintsTable).where(eq(complaintsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { status, ...updateData } = req.body;

    if (status && status !== existing.status) {
      // Record status change
      await db.insert(complaintUpdatesTable).values({
        complaintId: id,
        statusFrom: existing.status,
        statusTo: status,
        notes: req.body.resolution || `Status changed to ${status}`,
        changedBy: user.id,
      });

      if (status === "Closed") {
        updateData.closedAt = new Date();
        updateData.closedBy = user.id;
      }

      // Notify relevant users
      if (existing.assignedTo && existing.assignedTo !== user.id) {
        await createNotification({ userId: existing.assignedTo, type: "complaint_status_changed", title: "Complaint Status Updated", message: `Complaint ${existing.complaintNumber}: ${existing.status} → ${status}`, link: `/complaints/${id}`, relatedId: id, relatedType: "complaint" });
      }
    }

    const [updated] = await db.update(complaintsTable).set({ ...updateData, status: status || existing.status, updatedAt: new Date() }).where(eq(complaintsTable.id, id)).returning();

    res.json(await enrichComplaint(updated));
  } catch (err) {
    console.error("Update complaint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
