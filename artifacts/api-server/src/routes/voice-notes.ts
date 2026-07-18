import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, voiceNotesTable, dealsTable, productionOrdersTable, usersTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { storage } from "../lib/storage";
import { canAccessSalesResource } from "../lib/permission-service";
import path from "node:path";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max (~60s of audio)
});

// Allowed MIME types for voice notes
const ALLOWED_MIMES = new Set([
  "audio/webm", "audio/webm;codecs=opus",
  "audio/mpeg", "audio/mp3",
  "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/ogg;codecs=opus",
  "audio/mp4", "audio/m4a",
]);

// ────────────────────────────────────────────────
// POST /voice-notes — Upload a new voice note
// Body (multipart): file (audio), dealId, proformaInvoiceId?, productionOrderId?, transcript?
// ────────────────────────────────────────────────
router.post("/voice-notes", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      res.status(400).json({ error: "Invalid file type. Allowed: WebM, MP3, WAV, OGG, M4A" }); return;
    }

    const dealId = req.body.dealId ? Number(req.body.dealId) : null;
    const proformaInvoiceId = req.body.proformaInvoiceId ? Number(req.body.proformaInvoiceId) : null;
    const productionOrderId = req.body.productionOrderId ? Number(req.body.productionOrderId) : null;
    const transcript = req.body.transcript || null;
    const durationMs = req.body.durationMs ? Number(req.body.durationMs) : null;

    if (!dealId && !productionOrderId) {
      res.status(400).json({ error: "At least dealId or productionOrderId is required" }); return;
    }

    // Permission: sales users can only upload for their own deals
    if (dealId && user.role === "sales") {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
      if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }
      if (!canAccessSalesResource(user, deal.salesOwnerId)) {
        res.status(403).json({ error: "Not your deal" }); return;
      }
    }

    // Production users can also upload (for orders they have access to)
    if (productionOrderId && !dealId) {
      if (user.role === "sales") {
        res.status(403).json({ error: "Sales users must provide a dealId" }); return;
      }
    }

    const storagePath = await storage.save(file.originalname, file.buffer, "voice-notes");

    const [voiceNote] = await db.insert(voiceNotesTable).values({
      dealId,
      proformaInvoiceId,
      productionOrderId,
      uploadedById: user.id,
      fileName: path.basename(storagePath),
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath,
      durationMs,
      transcript,
      transcriptStatus: transcript ? "completed" : "pending",
    }).returning();

    res.status(201).json(voiceNote);
  } catch (err) {
    console.error("Voice note upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/deal/:dealId — Get active voice notes for a deal
// ────────────────────────────────────────────────
router.get("/voice-notes/deal/:dealId", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const dealId = Number(req.params.dealId);
    if (isNaN(dealId)) { res.status(400).json({ error: "Invalid deal id" }); return; }

    const notes = await db
      .select({
        id: voiceNotesTable.id,
        dealId: voiceNotesTable.dealId,
        proformaInvoiceId: voiceNotesTable.proformaInvoiceId,
        productionOrderId: voiceNotesTable.productionOrderId,
        uploadedById: voiceNotesTable.uploadedById,
        uploadedByName: usersTable.name,
        fileName: voiceNotesTable.fileName,
        originalName: voiceNotesTable.originalName,
        mimeType: voiceNotesTable.mimeType,
        fileSize: voiceNotesTable.fileSize,
        storagePath: voiceNotesTable.storagePath,
        durationMs: voiceNotesTable.durationMs,
        transcript: voiceNotesTable.transcript,
        transcriptStatus: voiceNotesTable.transcriptStatus,
        isReplaced: voiceNotesTable.isReplaced,
        createdAt: voiceNotesTable.createdAt,
      })
      .from(voiceNotesTable)
      .leftJoin(usersTable, eq(voiceNotesTable.uploadedById, usersTable.id))
      .where(
        and(
          eq(voiceNotesTable.dealId, dealId),
          eq(voiceNotesTable.isReplaced, false),
          isNull(voiceNotesTable.deletedAt),
        )
      )
      .orderBy(desc(voiceNotesTable.createdAt));

    // Attach playback URL
    const result = notes.map((n) => ({
      ...n,
      url: storage.getUrl(n.storagePath),
    }));

    res.json(result);
  } catch (err) {
    console.error("Get voice notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/production/:productionOrderId — Get active voice notes for a production order
// ────────────────────────────────────────────────
router.get("/voice-notes/production/:productionOrderId", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const poId = Number(req.params.productionOrderId);
    if (isNaN(poId)) { res.status(400).json({ error: "Invalid production order id" }); return; }

    // Production users can view; sales users only if they own the linked deal
    if (user.role === "sales") {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, poId));
      if (!po || !po.dealId) { res.status(404).json({ error: "Production order not found" }); return; }
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, po.dealId));
      if (!deal || !canAccessSalesResource(user, deal.salesOwnerId)) {
        res.status(403).json({ error: "Not your deal" }); return;
      }
    }

    const notes = await db
      .select({
        id: voiceNotesTable.id,
        dealId: voiceNotesTable.dealId,
        proformaInvoiceId: voiceNotesTable.proformaInvoiceId,
        productionOrderId: voiceNotesTable.productionOrderId,
        uploadedById: voiceNotesTable.uploadedById,
        uploadedByName: usersTable.name,
        fileName: voiceNotesTable.fileName,
        originalName: voiceNotesTable.originalName,
        mimeType: voiceNotesTable.mimeType,
        fileSize: voiceNotesTable.fileSize,
        storagePath: voiceNotesTable.storagePath,
        durationMs: voiceNotesTable.durationMs,
        transcript: voiceNotesTable.transcript,
        transcriptStatus: voiceNotesTable.transcriptStatus,
        isReplaced: voiceNotesTable.isReplaced,
        createdAt: voiceNotesTable.createdAt,
      })
      .from(voiceNotesTable)
      .leftJoin(usersTable, eq(voiceNotesTable.uploadedById, usersTable.id))
      .where(
        and(
          eq(voiceNotesTable.productionOrderId, poId),
          eq(voiceNotesTable.isReplaced, false),
          isNull(voiceNotesTable.deletedAt),
        )
      )
      .orderBy(desc(voiceNotesTable.createdAt));

    const result = notes.map((n) => ({
      ...n,
      url: storage.getUrl(n.storagePath),
    }));

    res.json(result);
  } catch (err) {
    console.error("Get voice notes for production error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// PATCH /voice-notes/:id/transcript — Update transcript text
// ────────────────────────────────────────────────
router.patch("/voice-notes/:id/transcript", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const { transcript } = req.body as { transcript?: string };
    if (transcript === undefined) { res.status(400).json({ error: "transcript is required" }); return; }

    const [existing] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Voice note not found" }); return; }
    if (existing.deletedAt) { res.status(404).json({ error: "Voice note has been deleted" }); return; }

    // Permission: only uploader or production users can edit transcript
    if (user.role === "sales" && existing.uploadedById !== user.id) {
      res.status(403).json({ error: "Not your voice note" }); return;
    }

    const [updated] = await db
      .update(voiceNotesTable)
      .set({ transcript, transcriptStatus: transcript ? "completed" : "pending" })
      .where(eq(voiceNotesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("Update transcript error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// DELETE /voice-notes/:id — Soft delete a voice note
// Only the uploader (while deal not yet accepted by Production) can delete
// ────────────────────────────────────────────────
router.delete("/voice-notes/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const [existing] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Voice note not found" }); return; }
    if (existing.deletedAt) { res.status(404).json({ error: "Already deleted" }); return; }

    // Sales can only delete their own voice notes
    if (user.role === "sales" && existing.uploadedById !== user.id) {
      res.status(403).json({ error: "Not your voice note" }); return;
    }

    await db
      .update(voiceNotesTable)
      .set({ deletedAt: new Date(), deletedById: user.id })
      .where(eq(voiceNotesTable.id, id));

    res.json({ success: true });
  } catch (err) {
    console.error("Delete voice note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// POST /voice-notes/:id/replace — Replace voice note (marks old as replaced, creates new)
// Body (multipart): file (audio), transcript?, durationMs?
// ────────────────────────────────────────────────
router.post("/voice-notes/:id/replace", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      res.status(400).json({ error: "Invalid file type" }); return;
    }

    const [existing] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Voice note not found" }); return; }
    if (existing.deletedAt) { res.status(404).json({ error: "Voice note has been deleted" }); return; }

    // Only uploader can replace
    if (user.role === "sales" && existing.uploadedById !== user.id) {
      res.status(403).json({ error: "Not your voice note" }); return;
    }

    const transcript = req.body.transcript || existing.transcript;
    const durationMs = req.body.durationMs ? Number(req.body.durationMs) : existing.durationMs;

    const storagePath = await storage.save(file.originalname, file.buffer, "voice-notes");

    // Mark old as replaced and create new in transaction
    const result = await db.transaction(async (tx) => {
      await tx
        .update(voiceNotesTable)
        .set({ isReplaced: true })
        .where(eq(voiceNotesTable.id, id));

      const [newNote] = await tx.insert(voiceNotesTable).values({
        dealId: existing.dealId,
        proformaInvoiceId: existing.proformaInvoiceId,
        productionOrderId: existing.productionOrderId,
        uploadedById: user.id,
        fileName: path.basename(storagePath),
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storagePath,
        durationMs,
        transcript,
        transcriptStatus: transcript ? "completed" : "pending",
        replacedById: id,
      }).returning();

      return newNote;
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("Replace voice note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
