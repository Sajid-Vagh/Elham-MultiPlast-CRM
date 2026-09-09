import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, voiceNotesTable, dealsTable, productionOrdersTable, contactsTable, proformaInvoicesTable, productionTimelineTable, usersTable, ordersTable } from "@workspace/db";
import { eq, and, isNull, desc, or, sql } from "drizzle-orm";
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

    // ── Notify recipients for production order voice notes ──
    const targetProdOrderId = crossLinkedProductionOrderId || productionOrderId;
    if (targetProdOrderId) {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, targetProdOrderId));
      const [uploader] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id));
      const uploaderName = uploader?.name || user.name || "Team";

      const senderDept =
        user.role === "production" || user.role === "production_manager" ? "Production"
          : user.role === "production_and_support" || user.role === "support" ? "Support"
            : user.role === "sales" ? "Sales"
              : user.role === "admin" ? "Admin"
                : user.role || "Team";

      const voiceTitle = `Voice Note from ${senderDept}`;

      // Resolve linked Sales Order and Sales Owner
      let salesOrderId: number | null = null;
      let salesOwnerId: number | null = null;

      const effectiveDealId = po?.dealId || crossLinkedDealId;
      if (effectiveDealId) {
        const [deal] = await db.select({ salesOwnerId: dealsTable.salesOwnerId })
          .from(dealsTable)
          .where(eq(dealsTable.id, effectiveDealId));
        if (deal?.salesOwnerId) salesOwnerId = deal.salesOwnerId;

        const [salesOrder] = await db.select({ id: ordersTable.id, salesOwnerId: ordersTable.salesOwnerId })
          .from(ordersTable)
          .where(and(eq(ordersTable.dealId, effectiveDealId), eq(ordersTable.isDeleted, false)))
          .limit(1);
        if (salesOrder) {
          salesOrderId = salesOrder.id;
          if (salesOrder.salesOwnerId) salesOwnerId = salesOrder.salesOwnerId;
        }
      }

      if (po?.proformaInvoiceId && !salesOwnerId) {
        const [inv] = await db.select({ contactId: proformaInvoicesTable.contactId })
          .from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, po.proformaInvoiceId));
        if (inv?.contactId) {
          const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId })
            .from(contactsTable).where(eq(contactsTable.id, inv.contactId));
          if (contact?.salesOwnerId) salesOwnerId = contact.salesOwnerId;
        }
      }

      const notifyUserIds: number[] = [];
      const pushRecipient = (id?: number | null) => {
        if (id && id !== user.id && !notifyUserIds.includes(id)) notifyUserIds.push(id);
      };

      // 1. Sales Owner
      pushRecipient(salesOwnerId);

      // 2. All Admins and Support users
      const adminAndSupportUsers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(or(eq(usersTable.role, "admin"), eq(usersTable.role, "support"), eq(usersTable.role, "production_and_support")));
      for (const u of adminAndSupportUsers) pushRecipient(u.id);

      // 3. If sender is NOT on the production side (e.g. Sales/Admin/Support), also notify production managers/users
      if (user.role !== "production" && user.role !== "production_manager") {
        pushRecipient(po?.assignedProductionManagerId);
        pushRecipient(po?.createdById);
        const prodUsers = await db.select({ id: usersTable.id }).from(usersTable)
          .where(or(eq(usersTable.role, "production"), eq(usersTable.role, "production_manager")));
        for (const u of prodUsers) pushRecipient(u.id);
      }

      const recipientRows = notifyUserIds.length
        ? await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, notifyUserIds))
        : [];
      const roleById = new Map(recipientRows.map((u) => [u.id, u.role]));

      for (const uid of notifyUserIds) {
        const link = roleById.get(uid) === "sales" && salesOrderId
          ? `/orders/${salesOrderId}`
          : `/production/orders/${targetProdOrderId}`;
        await createNotification({
          createdById: user.id,
          userId: uid,
          type: "voice_note",
          title: voiceTitle,
          message: `${uploaderName} recorded a voice note for order #${targetProdOrderId}`,
          link,
          relatedId: targetProdOrderId,
          relatedType: "production_order",
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
// GET /voice-notes/:id/stream — Stream audio bytes for playback (authenticated & authorized)
// ────────────────────────────────────────────────
router.get("/voice-notes/:id/stream", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid voice note id" }); return; }

    const [noteRow] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!noteRow || noteRow.deletedAt) {
      res.status(404).json({ error: "Voice note not found or unavailable" });
      return;
    }

    // Unit access authorization
    if (noteRow.dealId) {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, noteRow.dealId));
      if (deal) {
        const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
        if (!canAccessUnit(user, contact?.unit || null)) {
          res.status(403).json({ error: "Access denied: unit mismatch" });
          return;
        }
      }
    } else if (noteRow.productionOrderId) {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, noteRow.productionOrderId));
      if (po && !canAccessUnit(user, po.productionUnit || null)) {
        res.status(403).json({ error: "Access denied: unit mismatch" });
        return;
      }
    }

    const audioData = await getVoiceNoteAudioData(id);
    if (!audioData) {
      res.status(404).json({ error: "Voice note not found or unavailable" });
      return;
    }

    res.setHeader("Content-Type", audioData.mimeType);
    res.setHeader("Content-Length", audioData.data.length);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-cache");
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

    const [noteRow] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
    if (!noteRow || noteRow.deletedAt) {
      res.status(404).json({ error: "This voice note is unavailable." });
      return;
    }

    // Unit access authorization
    if (noteRow.dealId) {
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, noteRow.dealId));
      if (deal) {
        const [contact] = await db.select({ unit: contactsTable.unit }).from(contactsTable).where(eq(contactsTable.id, deal.contactId));
        if (!canAccessUnit(user, contact?.unit || null)) {
          res.status(403).json({ error: "Access denied: unit mismatch" });
          return;
        }
      }
    } else if (noteRow.productionOrderId) {
      const [po] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, noteRow.productionOrderId));
      if (po && !canAccessUnit(user, po.productionUnit || null)) {
        res.status(403).json({ error: "Access denied: unit mismatch" });
        return;
      }
    }

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

// ────────────────────────────────────────────────
// POST /voice-notes/:id/read — Mark a voice note as read by current user
// Appends user ID to the readBy array
// ────────────────────────────────────────────────
router.post("/voice-notes/:id/read", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const noteId = Number(req.params.id);
    if (isNaN(noteId)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.execute(sql`
      UPDATE voice_notes
      SET read_by = (
        SELECT array_agg(DISTINCT val)
        FROM unnest(
          COALESCE(read_by, '{}') || ARRAY[${sql`${user.id}`}::int]
        ) AS val
      )
      WHERE id = ${noteId}
    `);

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Mark voice note read error:");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
