import { Router, type IRouter } from "express";
import { db, internalNotesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

// Get internal notes for contact
router.get("/contacts/:id/notes", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.id);
    const notes = await db.select({
      id: internalNotesTable.id,
      note: internalNotesTable.note,
      department: internalNotesTable.department,
      isPinned: internalNotesTable.isPinned,
      isResolved: internalNotesTable.isResolved,
      createdBy: usersTable.name,
      createdAt: internalNotesTable.createdAt,
    }).from(internalNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, internalNotesTable.createdBy))
      .where(eq(internalNotesTable.contactId, contactId))
      .orderBy(desc(internalNotesTable.isPinned), desc(internalNotesTable.createdAt));

    res.json(notes);
  } catch (err) {
    console.error("Get notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create internal note
router.post("/contacts/:id/notes", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.id);
    const [note] = await db.insert(internalNotesTable).values({
      contactId,
      orderId: req.body.orderId,
      note: req.body.note,
      department: req.body.department || user.role,
      isPinned: req.body.isPinned || false,
      createdBy: user.id,
    }).returning();

    res.status(201).json(note);
  } catch (err) {
    console.error("Create note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update internal note
router.patch("/notes/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const [updated] = await db.update(internalNotesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(internalNotesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
