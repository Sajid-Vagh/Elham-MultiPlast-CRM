/**
 * Import Engine API Routes — Enterprise-grade import with multi-layer parsing,
 * preview, confidence scoring, duplicate detection, and self-learning.
 *
 * NEW endpoints:
 *   POST /import/parse-preview  — Multi-layer parse → preview before import
 *   POST /import/confirm        — Confirm import after preview edits
 *   GET  /import/history        — Import session history
 *   GET  /import/analytics      — Import analytics dashboard
 *   POST /import/correction     — Store self-learning correction
 *   GET  /import/corrections    — List learned corrections
 */

import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, CATEGORIES, dealsTable, activitiesTable, importSessionsTable, importCorrectionsTable } from "@workspace/db";
import { eq, or, and, desc, sql, count, ilike } from "drizzle-orm";
import { z } from "zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import {
  parseEnquiry,
  storeImportSession,
  storeCorrection,
  type ParsedLead,
  type ImportPreview,
} from "../lib/import-engine";

const router: IRouter = Router();

const CATEGORY_VALUES = [...CATEGORIES] as const;

// ─── POST /import/parse-preview ─────────────────────────────────────────────
// Multi-layer parse pipeline: V1 → V2 → Normalizer → Confidence → Duplicate → Preview
// Returns full preview without creating any lead.

router.post("/import/parse-preview", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { rawText } = req.body;
    if (!rawText || typeof rawText !== "string" || rawText.trim().length < 5) {
      res.status(400).json({ error: "rawText is required (min 5 characters)" });
      return;
    }

    const preview = await parseEnquiry(rawText.trim(), currentUser.id);

    // Store session for history (non-blocking)
    storeImportSession({
      userId: currentUser.id,
      source: "indiamart",
      rawText: rawText.trim(),
      parserVersion: preview.parserVersion,
      parsedData: preview.parsedData,
      editedData: preview.editedData,
      finalData: preview.finalData,
      confidence: preview.confidence,
      overallConfidence: preview.overallConfidence,
      duplicateDetected: preview.duplicate?.exists ?? false,
      duplicateContactId: preview.duplicate?.contactId ?? null,
      duplicateAction: null,
      resultLeadId: null,
      result: "preview",
      errorMessage: null,
    }).catch(() => {}); // fire-and-forget

    res.json(preview);
  } catch (err: any) {
    req.log?.error({ err }, "Parse preview error");
    res.status(500).json({ error: "Parse failed" });
  }
});

// ─── POST /import/confirm ───────────────────────────────────────────────────
// Import with edited data from preview. Stores full audit trail.

const ConfirmImportSchema = z.object({
  finalData: z.object({
    clientName: z.string(),
    clientMobile: z.string(),
    email: z.string().nullish(),
    companyName: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    requirement: z.string().nullish(),
    quantity: z.string().nullish(),
    address: z.string().nullish(),
    gstNumber: z.string().nullish(),
    industry: z.string().nullish(),
  }),
  salesOwnerId: z.number().nullish(),
  unit: z.string().nullish(),
  category: z.enum(CATEGORY_VALUES),
  duplicateAction: z.enum(["skip", "merge", "import_anyway"]).optional().default("skip"),
  duplicateContactId: z.number().nullish(),
  sessionId: z.number().nullish(),
});

router.post("/import/confirm", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = ConfirmImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error });
      return;
    }

    const fields = parsed.data;
    const contactName = fields.finalData.clientName?.trim() || "Unknown Lead";
    let contactMobile = fields.finalData.clientMobile?.trim() || "";

    // Sales users auto-assign
    let ownerId = fields.salesOwnerId ?? null;
    if (currentUser.role === "sales") ownerId = currentUser.id;

    if (!contactMobile) {
      contactMobile = `no-mobile-${Date.now()}`;
    }

    // Check duplicate
    const existing = await db.select().from(contactsTable).where(eq(contactsTable.mobile, contactMobile));

    if (existing.length > 0 && fields.duplicateAction === "skip") {
      res.status(409).json({
        duplicate: true,
        leadId: existing[0]!.id,
        customerName: existing[0]!.name,
        mobile: existing[0]!.mobile,
        message: "Duplicate detected — use duplicateAction: merge or import_anyway to proceed",
      });
      return;
    }

    // Handle merge
    if (existing.length > 0 && fields.duplicateAction === "merge") {
      const target = existing[0]!;
      await db.update(contactsTable).set({
        name: contactName,
        email: fields.finalData.email?.trim() ?? target.email,
        companyName: fields.finalData.companyName?.trim() ?? target.companyName,
        city: fields.finalData.city?.trim() ?? target.city,
        state: fields.finalData.state?.trim() ?? target.state,
        address: fields.finalData.address?.trim() ?? target.address,
        industry: fields.finalData.industry?.trim() ?? target.industry,
        customerComments: fields.finalData.requirement?.trim() ?? target.customerComments,
      }).where(eq(contactsTable.id, target.id));

      // Store session
      storeImportSession({
        userId: currentUser.id,
        source: "indiamart",
        rawText: "",
        parserVersion: "confirm",
        parsedData: {},
        editedData: {},
        finalData: fields.finalData,
        confidence: {},
        overallConfidence: 0,
        duplicateDetected: true,
        duplicateContactId: target.id,
        duplicateAction: "merge",
        resultLeadId: target.id,
        result: "merged",
        errorMessage: null,
      }).catch(() => {});

      res.status(200).json({ ...target, merged: true });
      return;
    }

    // Create new lead
    if (!ownerId) {
      const [firstUser] = await db.select().from(usersTable).limit(1);
      ownerId = firstUser?.id;
    }
    if (!ownerId) {
      res.status(400).json({ error: "No sales owner available" });
      return;
    }

    const notes = [fields.finalData.requirement, fields.finalData.quantity ? `Qty: ${fields.finalData.quantity}` : null]
      .filter(Boolean).join(" | ");

    const [contact] = await db.insert(contactsTable).values({
      name: contactName,
      mobile: contactMobile,
      email: fields.finalData.email?.trim() ?? null,
      companyName: fields.finalData.companyName?.trim() ?? null,
      city: fields.finalData.city?.trim() ?? null,
      state: fields.finalData.state?.trim() ?? null,
      address: fields.finalData.address?.trim() ?? null,
      salesOwnerId: ownerId,
      leadSource: "IndiaMart",
      inquiryDate: new Date().toISOString().split("T")[0]!,
      unit: fields.unit?.trim() ?? null,
      industry: fields.finalData.industry?.trim() ?? null,
      category: fields.category,
      customerComments: fields.finalData.requirement?.trim() ?? null,
    }).returning();

    // Notification
    await createNotification({
      userId: ownerId,
      type: "assignment",
      title: "New IndiaMART Enquiry Assigned",
      message: `Customer: ${contactName}${fields.finalData.requirement ? `\nProduct: ${fields.finalData.requirement.slice(0, 80)}` : ""}\nAssigned By: ${currentUser.name}`,
      link: `/leads/${contact!.id}`,
      relatedId: contact!.id,
      relatedType: "contact",
    });

    // Store session
    storeImportSession({
      userId: currentUser.id,
      source: "indiamart",
      rawText: "",
      parserVersion: "confirm",
      parsedData: {},
      editedData: {},
      finalData: fields.finalData,
      confidence: {},
      overallConfidence: 0,
      duplicateDetected: false,
      duplicateContactId: null,
      duplicateAction: null,
      resultLeadId: contact!.id,
      result: "imported",
      errorMessage: null,
    }).catch(() => {});

    res.status(201).json({ ...contact, notes });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Contact with this mobile already exists", duplicate: true });
      return;
    }
    req.log?.error({ err }, "Import confirm error");
    res.status(500).json({ error: "Import failed" });
  }
});

// ─── GET /import/history ────────────────────────────────────────────────────

router.get("/import/history", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
    const offset = parseInt(String(req.query.offset)) || 0;

    const sessions = await db.select({
      id: importSessionsTable.id,
      source: importSessionsTable.source,
      parserVersion: importSessionsTable.parserVersion,
      overallConfidence: importSessionsTable.overallConfidence,
      duplicateDetected: importSessionsTable.duplicateDetected,
      result: importSessionsTable.result,
      errorMessage: importSessionsTable.errorMessage,
      resultLeadId: importSessionsTable.resultLeadId,
      createdAt: importSessionsTable.createdAt,
      userName: usersTable.name,
    })
      .from(importSessionsTable)
      .leftJoin(usersTable, eq(importSessionsTable.userId, usersTable.id))
      .orderBy(desc(importSessionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ count: count() }).from(importSessionsTable);

    res.json({ sessions, total: totalRow?.count || 0 });
  } catch (err: any) {
    req.log?.error({ err }, "Import history error");
    res.status(500).json({ error: "Failed to load history" });
  }
});

// ─── GET /import/analytics ──────────────────────────────────────────────────

router.get("/import/analytics", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const [totalRow] = await db.select({ count: count() }).from(importSessionsTable);
    const [importedRow] = await db.select({ count: count() }).from(importSessionsTable)
      .where(eq(importSessionsTable.result, "imported"));
    const [dupRow] = await db.select({ count: count() }).from(importSessionsTable)
      .where(eq(importSessionsTable.duplicateDetected, true));
    const [failedRow] = await db.select({ count: count() }).from(importSessionsTable)
      .where(eq(importSessionsTable.result, "error"));
    const [avgConfRow] = await db.select({
      avg: sql<number>`COALESCE(AVG(CAST(${importSessionsTable.overallConfidence} AS NUMERIC)), 0)`,
    }).from(importSessionsTable);
    const [v1Row] = await db.select({ count: count() }).from(importSessionsTable)
      .where(eq(importSessionsTable.parserVersion, "v1"));
    const [v1v2Row] = await db.select({ count: count() }).from(importSessionsTable)
      .where(eq(importSessionsTable.parserVersion, "v1+v2"));

    const correctionsCount = await db.select({ count: count() }).from(importCorrectionsTable);

    res.json({
      totalImports: totalRow?.count || 0,
      successfulImports: importedRow?.count || 0,
      duplicateImports: dupRow?.count || 0,
      failedImports: failedRow?.count || 0,
      averageConfidence: Math.round(Number(avgConfRow?.avg) || 0),
      parserUsage: {
        v1: v1Row?.count || 0,
        v1v2: v1v2Row?.count || 0,
      },
      totalCorrections: correctionsCount[0]?.count || 0,
    });
  } catch (err: any) {
    req.log?.error({ err }, "Import analytics error");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ─── POST /import/correction ────────────────────────────────────────────────

router.post("/import/correction", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { field, originalValue, correctedValue } = req.body;
    if (!field || !originalValue || !correctedValue) {
      res.status(400).json({ error: "field, originalValue, correctedValue required" });
      return;
    }

    await storeCorrection(field, originalValue, correctedValue, currentUser.id);
    res.json({ ok: true });
  } catch (err: any) {
    req.log?.error({ err }, "Correction error");
    res.status(500).json({ error: "Failed to store correction" });
  }
});

// ─── GET /import/corrections ────────────────────────────────────────────────

router.get("/import/corrections", async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const corrections = await db.select().from(importCorrectionsTable)
      .orderBy(desc(importCorrectionsTable.hitCount))
      .limit(100);

    res.json({ corrections });
  } catch (err: any) {
    req.log?.error({ err }, "Corrections list error");
    res.status(500).json({ error: "Failed to load corrections" });
  }
});

export default router;
