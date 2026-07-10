import { Router, type IRouter } from "express";
import { db, customerCommunicationsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

// Get communications for a contact
router.get("/contacts/:id/communications", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.id);
    const comms = await db.select({
      id: customerCommunicationsTable.id,
      type: customerCommunicationsTable.type,
      direction: customerCommunicationsTable.direction,
      notes: customerCommunicationsTable.notes,
      nextAction: customerCommunicationsTable.nextAction,
      nextActionDate: customerCommunicationsTable.nextActionDate,
      department: customerCommunicationsTable.department,
      createdBy: usersTable.name,
      createdAt: customerCommunicationsTable.createdAt,
    }).from(customerCommunicationsTable)
      .leftJoin(usersTable, eq(usersTable.id, customerCommunicationsTable.createdBy))
      .where(eq(customerCommunicationsTable.contactId, contactId))
      .orderBy(desc(customerCommunicationsTable.createdAt));

    res.json(comms);
  } catch (err) {
    console.error("Get communications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create communication
router.post("/contacts/:id/communications", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.id);
    const [comm] = await db.insert(customerCommunicationsTable).values({
      contactId,
      orderId: req.body.orderId,
      type: req.body.type,
      direction: req.body.direction || "Outbound",
      notes: req.body.notes,
      nextAction: req.body.nextAction,
      nextActionDate: req.body.nextActionDate,
      department: req.body.department || user.role,
      createdBy: user.id,
    }).returning();

    res.status(201).json(comm);
  } catch (err) {
    console.error("Create communication error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
