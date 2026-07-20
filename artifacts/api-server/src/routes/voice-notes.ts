import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { db, voiceNotesTable, dealsTable, productionOrdersTable, contactsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { canAccessUnit } from "../lib/permission-service";
import { storage } from "../lib/storage";
import {
  uploadVoiceNote,
  getVoiceNotes,
  deleteVoiceNote,
  verifyFileAvailability,
  validateVoiceNoteFile,
  type VoiceNoteEntityType,
} from "../lib/voice-notes-service";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ────────────────────────────────────────────────
// POST /voice-notes — Upload a new voice note
// Body (multipart): file, + entityType + entityId + optional metadata
// ────────────────────────────────────────────────
router.post("/voice-notes", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const validationError = validateVoiceNoteFile(req.file!);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    const file = req.file!;
    const entityType = req.body.entityType as VoiceNoteEntityType | undefined;
    const entityId = req.body.entityId ? Number(req.body.entityId) : null;
    const durationMs = req.body.durationMs ? Number(req.body.durationMs) : null;
    const transcript = req.body.transcript || null;

    // Support legacy fields for backward compatibility
    const dealId = entityType === "deal" ? entityId : req.body.dealId ? Number(req.body.dealId) : null;
    const productionOrderId = entityType === "production" ? entityId : req.body.productionOrderId ? Number(req.body.productionOrderId) : null;
    const proformaInvoiceId = entityType === "proforma" ? entityId : req.body.proformaInvoiceId ? Number(req.body.proformaInvoiceId) : null;
    const orderId = entityType === "order" ? entityId : req.body.orderId ? Number(req.body.orderId) : null;
    const leadId = entityType === "lead" ? entityId : req.body.leadId ? Number(req.body.leadId) : null;
    const customerId = entityType === "customer" ? entityId : req.body.customerId ? Number(req.body.customerId) : null;

    if (!dealId && !productionOrderId && !orderId && !leadId && !customerId && !proformaInvoiceId) {
      res.status(400).json({ error: "At least one entity reference is required (dealId, productionOrderId, orderId, leadId, customerId, or entityType+entityId)" });
      return;
    }

    // Unit isolation check
    if (dealId) {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
      if (deal) {
        const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
        if (!canAccessUnit(user, contact?.unit || null)) {
          res.status(403).json({ error: "Access denied: unit mismatch" }); return;
        }
      }
    } else if (productionOrderId) {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, productionOrderId));
      if (po && !canAccessUnit(user, po.productionUnit || null)) {
        res.status(403).json({ error: "Access denied: unit mismatch" }); return;
      }
    }

    const { note, error } = await uploadVoiceNote({
      file,
      uploadedById: user.id,
      createdByRole: user.role,
      dealId,
      productionOrderId,
      proformaInvoiceId,
      orderId,
      leadId,
      customerId,
      durationMs,
      transcript,
    });

    if (error || !note) {
      res.status(500).json({ error: error || "Failed to upload voice note" }); return;
    }

    res.status(201).json(note);
  } catch (err) {
    console.error("Voice note upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes — Unified list endpoint
// Query: type=deal|production|order|lead|customer|proforma&id=123
// ────────────────────────────────────────────────
router.get("/voice-notes", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const entityType = req.query.type as VoiceNoteEntityType | undefined;
    const entityId = req.query.id ? Number(req.query.id) : null;

    if (!entityType || !entityId || isNaN(entityId)) {
      res.status(400).json({ error: "Query parameters 'type' and 'id' are required" });
      return;
    }

    // Unit isolation check
    if (entityType === "deal") {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, entityId));
      if (deal) {
        const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
        if (!canAccessUnit(user, contact?.unit || null)) {
          res.status(403).json({ error: "Access denied: unit mismatch" }); return;
        }
      }
    } else if (entityType === "production") {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, entityId));
      if (po && !canAccessUnit(user, po.productionUnit || null)) {
        res.status(403).json({ error: "Access denied: unit mismatch" }); return;
      }
    }

    // Legacy endpoint support: /voice-notes/deal/:dealId and /voice-notes/production/:prodId
    const notes = await getVoiceNotes(entityType, entityId, user.id, user.role);
    res.json(notes);
  } catch (err) {
    console.error("Get voice notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// Legacy: GET /voice-notes/deal/:dealId
// ────────────────────────────────────────────────
router.get("/voice-notes/deal/:dealId", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dealId = Number(req.params.dealId);
    if (isNaN(dealId)) { res.status(400).json({ error: "Invalid deal id" }); return; }

    const notes = await getVoiceNotes("deal", dealId, user.id, user.role);
    res.json(notes);
  } catch (err) {
    console.error("Get voice notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Legacy: GET /voice-notes/production/:productionOrderId
router.get("/voice-notes/production/:productionOrderId", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const poId = Number(req.params.productionOrderId);
    if (isNaN(poId)) { res.status(400).json({ error: "Invalid production order id" }); return; }

    const notes = await getVoiceNotes("production", poId, user.id, user.role);
    res.json(notes);
  } catch (err) {
    console.error("Get voice notes error:", err);
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
// DELETE /voice-notes/:id — Hard delete (removes file + DB record)
// ────────────────────────────────────────────────
router.delete("/voice-notes/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const result = await deleteVoiceNote(id, user.id);
    if (!result.success) {
      res.status(404).json({ error: result.error || "Voice note not found" }); return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete voice note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/:id/verify — Check file availability
// ────────────────────────────────────────────────
router.get("/voice-notes/:id/verify", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const available = await verifyFileAvailability(id);
    if (!available) {
      res.json({ available: false, message: "This voice note is unavailable." });
      return;
    }

    res.json({ available: true });
  } catch (err) {
    console.error("Verify voice note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// POST /voice-notes/:id/replace — Replace voice note (versioning)
// ────────────────────────────────────────────────
router.post("/voice-notes/:id/replace", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const validationError = validateVoiceNoteFile(req.file!);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    const file = req.file!;

    const [existing] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Voice note not found" }); return; }
    if (existing.deletedAt) { res.status(404).json({ error: "Voice note has been deleted" }); return; }

    const transcript = req.body.transcript || existing.transcript;
    const durationMs = req.body.durationMs ? Number(req.body.durationMs) : existing.durationMs;

    // Check unit access
    if (existing.dealId) {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, existing.dealId));
      if (deal) {
        const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
        if (!canAccessUnit(user, contact?.unit || null)) {
          res.status(403).json({ error: "Access denied: unit mismatch" }); return;
        }
      }
    } else if (existing.productionOrderId) {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, existing.productionOrderId));
      if (po && !canAccessUnit(user, po.productionUnit || null)) {
        res.status(403).json({ error: "Access denied: unit mismatch" }); return;
      }
    }

    const { note, error } = await uploadVoiceNote({
      file,
      uploadedById: user.id,
      createdByRole: user.role,
      dealId: existing.dealId,
      productionOrderId: existing.productionOrderId,
      proformaInvoiceId: existing.proformaInvoiceId,
      orderId: existing.orderId,
      leadId: existing.leadId,
      customerId: existing.customerId,
      durationMs,
      transcript,
    });

    if (error || !note) {
      res.status(500).json({ error: error || "Failed to replace voice note" }); return;
    }

    // Mark old as replaced
    await db.update(voiceNotesTable)
      .set({ isReplaced: true, replacedById: note.id })
      .where(eq(voiceNotesTable.id, id));

    // Delete old file
    if (existing.storagePath) {
      try { fs.promises.unlink(storage.getPhysicalPath(existing.storagePath)); } catch {}
    }

    res.status(201).json(note);
  } catch (err) {
    console.error("Replace voice note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/:id/download — Download voice note file
// ────────────────────────────────────────────────
router.get("/voice-notes/:id/download", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const [note] = await db
      .select()
      .from(voiceNotesTable)
      .where(and(eq(voiceNotesTable.id, id), isNull(voiceNotesTable.deletedAt)));

    if (!note) { res.status(404).json({ error: "Voice note not found" }); return; }

    const filePath = storage.getPhysicalPath(note.storagePath);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "This voice note is unavailable." }); return;
    }

    res.download(filePath, note.originalName);
  } catch (err) {
    console.error("Download voice note error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
