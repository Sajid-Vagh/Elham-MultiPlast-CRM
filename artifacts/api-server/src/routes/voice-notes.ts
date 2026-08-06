import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, voiceNotesTable, dealsTable, productionOrdersTable, contactsTable, proformaInvoicesTable, productionTimelineTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { canAccessUnit } from "../lib/permission-service";
import { createNotification } from "./notifications";
import {
  uploadVoiceNote,
  getVoiceNotes,
  deleteVoiceNote,
  verifyFileAvailability,
  validateVoiceNoteFile,
  getVoiceNoteAudioData,
  getVoiceNotesDiagnostics,
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

    // ── Cross-link: find linked entity on the other side ──
    let crossLinkedDealId = dealId;
    let crossLinkedProductionOrderId = productionOrderId;
    let crossLinkedProformaInvoiceId = proformaInvoiceId;

    if (dealId && !productionOrderId) {
      const [linkedPO] = await db.select({ id: productionOrdersTable.id, productionUnit: productionOrdersTable.productionUnit })
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.dealId, dealId))
        .orderBy(desc(productionOrdersTable.createdAt))
        .limit(1);
      if (linkedPO) {
        crossLinkedProductionOrderId = linkedPO.id;
      }
    }

    if (productionOrderId && !dealId) {
      const [po] = await db.select({ dealId: productionOrdersTable.dealId, proformaInvoiceId: productionOrdersTable.proformaInvoiceId })
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.id, productionOrderId))
        .limit(1);
      if (po?.dealId) {
        crossLinkedDealId = po.dealId;
      } else if (po?.proformaInvoiceId) {
        const [pi] = await db.select({ dealId: proformaInvoicesTable.dealId })
          .from(proformaInvoicesTable)
          .where(eq(proformaInvoicesTable.id, po.proformaInvoiceId))
          .limit(1);
        if (pi?.dealId) crossLinkedDealId = pi.dealId;
      }
      if (po?.proformaInvoiceId && !crossLinkedProformaInvoiceId) {
        crossLinkedProformaInvoiceId = po.proformaInvoiceId;
      }
    }

    if (proformaInvoiceId && !dealId && !productionOrderId) {
      const [pi] = await db.select({ dealId: proformaInvoicesTable.dealId })
        .from(proformaInvoicesTable)
        .where(eq(proformaInvoicesTable.id, proformaInvoiceId))
        .limit(1);
      if (pi?.dealId) crossLinkedDealId = pi.dealId;
      const [linkedPO] = await db.select({ id: productionOrdersTable.id })
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.proformaInvoiceId, proformaInvoiceId))
        .limit(1);
      if (linkedPO) crossLinkedProductionOrderId = linkedPO.id;
    }

    const { note, error } = await uploadVoiceNote({
      file,
      uploadedById: user.id,
      createdByRole: user.role,
      dealId: crossLinkedDealId,
      productionOrderId: crossLinkedProductionOrderId,
      proformaInvoiceId: crossLinkedProformaInvoiceId,
      orderId,
      leadId,
      customerId,
      durationMs,
      transcript,
    });

    if (error || !note) {
      res.status(500).json({ error: error || "Failed to upload voice note" }); return;
    }

    // ── Notify the other side ──
    if (crossLinkedProductionOrderId && dealId && !productionOrderId) {
      const [po] = await db.select({ productionUnit: productionOrdersTable.productionUnit })
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.id, crossLinkedProductionOrderId));
      const [uploader] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id));
      const prodUsers = await db.select({ id: usersTable.id, unit: usersTable.unit, role: usersTable.role })
        .from(usersTable)
        .where(or(eq(usersTable.role, "production"), eq(usersTable.role, "production_and_support"), eq(usersTable.role, "admin")));
      const orderUnit = po?.productionUnit || "Himatnagar";
      for (const pu of prodUsers) {
        if (pu.id === user.id) continue;
        const userUnit = pu.unit || "All";
        if (pu.role === "admin" || userUnit === "All" || userUnit === orderUnit || orderUnit === "Himatnagar") {
          await createNotification({
            createdById: user.id,
            userId: pu.id,
            type: "voice_note",
            title: "Voice Note from Sales",
            message: `${uploader?.name || "Sales"} recorded a voice note for this order`,
            link: `/production/orders/${crossLinkedProductionOrderId}`,
            relatedId: crossLinkedProductionOrderId,
            relatedType: "production_order",
          });
        }
      }
    }

    if (crossLinkedDealId && productionOrderId && !dealId) {
      const [deal] = await db.select({ salesOwnerId: dealsTable.salesOwnerId, title: dealsTable.title })
        .from(dealsTable)
        .where(eq(dealsTable.id, crossLinkedDealId));
      const [uploader] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id));
      if (deal?.salesOwnerId && String(deal.salesOwnerId) !== String(user.id)) {
        await createNotification({
          createdById: user.id,
          userId: deal.salesOwnerId,
          type: "voice_note",
          title: "Voice Note from Production",
          message: `${uploader?.name || "Production"} recorded a voice note for order #${productionOrderId}`,
          link: `/leads/${crossLinkedDealId}`,
          relatedId: crossLinkedDealId,
          relatedType: "deal",
        });
      }
    }

    // ── Add production timeline entry ──
    if (crossLinkedProductionOrderId) {
      const [uploader] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id));
      try {
        await db.insert(productionTimelineTable).values({
          productionOrderId: crossLinkedProductionOrderId,
          status: "Voice Note",
          notes: `Voice note added by ${uploader?.name || user.role}`,
          createdBy: user.id,
        });
      } catch (_) { /* timeline entry is best-effort */ }
    }

    res.status(201).json(note);
  } catch (err) {
    req.log.error({ err }, "Voice note upload error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    const notes = await getVoiceNotes(entityType, entityId, user.id, user.role);
    res.json(notes);
  } catch (err) {
    req.log.error({ err }, "Get voice notes error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    req.log.error({ err }, "Get voice notes error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    req.log.error({ err }, "Get voice notes error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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
    req.log.error({ err }, "Update transcript error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────
// PATCH /voice-notes/:id — Update voice note (link to production order, transcript, etc.)
// ────────────────────────────────────────────────
router.patch("/voice-notes/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const [existing] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Voice note not found" }); return; }
    if (existing.deletedAt) { res.status(404).json({ error: "Voice note has been deleted" }); return; }

    const { productionOrderId, proformaInvoiceId, transcript } = req.body as Record<string, any>;
    const updateFields: Record<string, any> = {};

    if (productionOrderId !== undefined) updateFields.productionOrderId = Number(productionOrderId);
    if (proformaInvoiceId !== undefined) updateFields.proformaInvoiceId = Number(proformaInvoiceId);
    if (transcript !== undefined) {
      updateFields.transcript = transcript;
      updateFields.transcriptStatus = transcript ? "completed" : "pending";
    }

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: "No fields to update" }); return;
    }

    const [updated] = await db
      .update(voiceNotesTable)
      .set(updateFields)
      .where(eq(voiceNotesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update voice note error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────
// DELETE /voice-notes/:id — Hard delete (removes DB record + audio bytes)
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
    req.log.error({ err }, "Delete voice note error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/:id/stream — Stream audio bytes for <audio> playback
// Public endpoint (no auth) — access is gated by the list endpoint.
// The <audio> element cannot send custom headers, so this must be public.
// ────────────────────────────────────────────────
router.get("/voice-notes/:id/stream", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const audioData = await getVoiceNoteAudioData(id);
    if (!audioData) {
      res.status(404).json({ error: "Voice note not found or unavailable" });
      return;
    }

    res.setHeader("Content-Type", audioData.mimeType);
    res.setHeader("Content-Length", audioData.data.length);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(audioData.data);
  } catch (err) {
    req.log.error({ err }, "Stream voice note error:");
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal Server Error" });
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
    req.log.error({ err }, "Verify voice note error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    res.status(201).json(note);
  } catch (err) {
    req.log.error({ err }, "Replace voice note error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/:id/download — Download voice note file (with auth)
// ────────────────────────────────────────────────
router.get("/voice-notes/:id/download", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const audioData = await getVoiceNoteAudioData(id);
    if (!audioData) {
      res.status(404).json({ error: "This voice note is unavailable." });
      return;
    }

    res.setHeader("Content-Type", audioData.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${audioData.fileName}"`);
    res.setHeader("Content-Length", audioData.data.length);
    res.end(audioData.data);
  } catch (err) {
    req.log.error({ err }, "Download voice note error:");
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────
// GET /voice-notes/diagnostics — Full diagnostic report for all voice notes
// Admin-only endpoint for debugging storage issues
// ────────────────────────────────────────────────
router.get("/voice-notes/diagnostics", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

    const diagnostics = await getVoiceNotesDiagnostics();
    res.json(diagnostics);
  } catch (err) {
    req.log.error({ err }, "Voice note diagnostics error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
