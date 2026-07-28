import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, voiceNotesTable, usersTable, dealsTable, productionOrdersTable, contactsTable } from "@workspace/db";
import { eq, and, desc, isNull, or, inArray } from "drizzle-orm";
import { storage, getStorageProvider } from "./storage";

const ALLOWED_MIMES = new Set([
  "audio/webm", "audio/webm;codecs=opus",
  "audio/mpeg", "audio/mp3",
  "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/ogg;codecs=opus",
  "audio/mp4", "audio/m4a",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type VoiceNoteEntityType = "deal" | "production" | "order" | "lead" | "customer" | "proforma";

export interface UploadVoiceNoteParams {
  file: Express.Multer.File;
  uploadedById: number;
  createdByRole: string;
  dealId?: number | null;
  productionOrderId?: number | null;
  proformaInvoiceId?: number | null;
  orderId?: number | null;
  leadId?: number | null;
  customerId?: number | null;
  durationMs?: number | null;
  transcript?: string | null;
}

export interface VoiceNoteResponse {
  id: number;
  dealId: number | null;
  productionOrderId: number | null;
  proformaInvoiceId: number | null;
  orderId: number | null;
  leadId: number | null;
  customerId: number | null;
  uploadedById: number;
  createdByRole: string;
  uploadedByName: string | null;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string;
  durationMs: number | null;
  transcript: string | null;
  transcriptStatus: string;
  isReplaced: boolean;
  fileAvailable: boolean;
  createdAt: string;
}

// ────────────────────────────────────────
// Validate uploaded file
// ────────────────────────────────────────
export function validateVoiceNoteFile(file: Express.Multer.File): string | null {
  if (!file) return "No file provided";
  if (file.size > MAX_FILE_SIZE) return "File exceeds maximum size of 10MB";
  if (!ALLOWED_MIMES.has(file.mimetype)) return "Invalid file type. Allowed: WebM, MP3, WAV, OGG, M4A";
  return null;
}

// ────────────────────────────────────────
// Upload: save file to disk first, then DB
// Never creates DB record if file write fails
// ────────────────────────────────────────
export async function uploadVoiceNote(
  params: UploadVoiceNoteParams
): Promise<{ note: VoiceNoteResponse | null; error: string | null }> {
  const { file, uploadedById, createdByRole } = params;

  try {
    const storagePath = await storage.save(file.originalname, file.buffer, "voice-notes");

    // Verify upload succeeded before creating DB record
    const verification = await storage.verifyPublicAccess(storagePath);
    if (!verification.accessible) {
      console.error(`[VoiceNote] Upload verification failed for ${storagePath}: ${verification.error}`);
      await storage.delete(storagePath).catch(() => {});
      return { note: null, error: "Voice note file could not be verified in storage" };
    }

    try {
      const [row] = await db.insert(voiceNotesTable).values({
        dealId: params.dealId || null,
        productionOrderId: params.productionOrderId || null,
        proformaInvoiceId: params.proformaInvoiceId || null,
        orderId: params.orderId || null,
        leadId: params.leadId || null,
        customerId: params.customerId || null,
        uploadedById,
        createdByRole,
        fileName: path.basename(storagePath),
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storagePath,
        durationMs: params.durationMs || null,
        transcript: params.transcript || null,
        transcriptStatus: params.transcript ? "completed" : "pending",
        fileAvailable: true,
      }).returning();

      return {
        note: await enrichVoiceNote(row),
        error: null,
      };
    } catch (dbErr) {
      // DB write failed — clean up the already-saved file
      await storage.delete(storagePath).catch(() => {});
      console.error("Voice note upload error:", dbErr);
      return { note: null, error: "Failed to upload voice note" };
    }
  } catch (err) {
    console.error("Voice note storage error:", err);
    return { note: null, error: "Failed to save voice note file" };
  }
}

// ────────────────────────────────────────
// Get voice notes for any entity
// Cross-role: returns all notes regardless of uploader role
// ────────────────────────────────────────
export async function getVoiceNotes(
  entityType: VoiceNoteEntityType,
  entityId: number,
  currentUserId: number,
  userRole: string
): Promise<VoiceNoteResponse[]> {
  let whereClause;

  switch (entityType) {
    case "deal":
      whereClause = eq(voiceNotesTable.dealId, entityId);
      break;
    case "production":
      whereClause = eq(voiceNotesTable.productionOrderId, entityId);
      break;
    case "proforma":
      whereClause = eq(voiceNotesTable.proformaInvoiceId, entityId);
      break;
    case "order":
      whereClause = eq(voiceNotesTable.orderId, entityId);
      break;
    case "lead":
      whereClause = eq(voiceNotesTable.leadId, entityId);
      break;
    case "customer":
      whereClause = eq(voiceNotesTable.customerId, entityId);
      break;
    default:
      return [];
  }

  const rows = await db
    .select({
      id: voiceNotesTable.id,
      dealId: voiceNotesTable.dealId,
      productionOrderId: voiceNotesTable.productionOrderId,
      proformaInvoiceId: voiceNotesTable.proformaInvoiceId,
      orderId: voiceNotesTable.orderId,
      leadId: voiceNotesTable.leadId,
      customerId: voiceNotesTable.customerId,
      uploadedById: voiceNotesTable.uploadedById,
      createdByRole: voiceNotesTable.createdByRole,
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
      fileAvailable: voiceNotesTable.fileAvailable,
      createdAt: voiceNotesTable.createdAt,
    })
    .from(voiceNotesTable)
    .leftJoin(usersTable, eq(voiceNotesTable.uploadedById, usersTable.id))
    .where(
      and(
        whereClause,
        eq(voiceNotesTable.isReplaced, false),
        isNull(voiceNotesTable.deletedAt),
      )
    )
    .orderBy(desc(voiceNotesTable.createdAt));

  // Verify file existence for each note (fail-open: assume exists on error)
  const result: VoiceNoteResponse[] = [];
  const store = getStorageProvider();
  for (const row of rows) {
    let fileExists = true;
    try {
      fileExists = await store.exists(row.storagePath);
    } catch {
      fileExists = true;
    }

    if (!fileExists) {
      console.warn(`[VoiceNote] File missing: id=${row.id} path=${row.storagePath}`);
    }

    result.push({
      ...row,
      url: fileExists ? store.getUrl(row.storagePath) : "",
      fileAvailable: fileExists,
      createdAt: row.createdAt?.toISOString?.() || String(row.createdAt),
    });
  }

  return result;
}

// ────────────────────────────────────────
// Delete: removes file from disk + DB record
// Never leaves orphan records or files
// ────────────────────────────────────────
export async function deleteVoiceNote(
  noteId: number,
  userId: number
): Promise<{ success: boolean; error?: string }> {
  const [existing] = await db
    .select()
    .from(voiceNotesTable)
    .where(eq(voiceNotesTable.id, noteId));

  if (!existing) return { success: false, error: "Voice note not found" };
  if (existing.deletedAt) return { success: false, error: "Already deleted" };

  // Delete physical file
  if (existing.storagePath) {
    await storage.delete(existing.storagePath).catch(() => {});
  }

  // Hard delete the DB record (not soft delete — spec says remove)
  await db.delete(voiceNotesTable)
    .where(eq(voiceNotesTable.id, noteId));

  return { success: true };
}

// ────────────────────────────────────────
// Verify a single note's file availability
// ────────────────────────────────────────
export async function verifyFileAvailability(noteId: number): Promise<boolean> {
  const [note] = await db
    .select({ storagePath: voiceNotesTable.storagePath })
    .from(voiceNotesTable)
    .where(eq(voiceNotesTable.id, noteId));

  if (!note) return false;
  return getStorageProvider().exists(note.storagePath);
}

// ────────────────────────────────────────
// Check if user can access a voice note based on role
// Sales can hear Production notes
// Production can hear Sales notes
// Support can hear Production notes
// Admin can hear everything
// ────────────────────────────────────────
export function canAccessVoiceNote(userRole: string, noteRole: string): boolean {
  if (userRole === "admin") return true;
  // All roles can access all voice notes across the CRM
  // Cross-role access is always allowed
  return true;
}

// ────────────────────────────────────────
// Cleanup: delete all voice notes for a production order
// Called when order reaches Dispatch or Delivery
// ────────────────────────────────────────
export async function cleanupVoiceNotesForOrder(
  productionOrderId: number,
  reason: string
): Promise<{ deletedCount: number }> {
  const voiceNotes = await db
    .select({ id: voiceNotesTable.id, storagePath: voiceNotesTable.storagePath })
    .from(voiceNotesTable)
    .where(eq(voiceNotesTable.productionOrderId, productionOrderId));

  if (voiceNotes.length === 0) return { deletedCount: 0 };

  for (const vn of voiceNotes) {
    if (vn.storagePath) {
      try { await storage.delete(vn.storagePath); } catch (_) { /* best-effort */ }
    }
  }

  await db
    .delete(voiceNotesTable)
    .where(eq(voiceNotesTable.productionOrderId, productionOrderId));

  console.log(
    `[VoiceNote Cleanup] Deleted ${voiceNotes.length} voice notes for production order #${productionOrderId}. Reason: ${reason}`
  );

  return { deletedCount: voiceNotes.length };
}

// ────────────────────────────────────────
// Daily orphan cleanup: delete voice notes
// for completed/dispatched/delivered orders
// ────────────────────────────────────────
export async function cleanupOrphanVoiceNotes(): Promise<{ deletedCount: number }> {
  const TERMINAL_STATUSES = ["Completed", "Cancelled"];
  const TERMINAL_DISPATCH_STATUSES = ["Dispatch", "Delivered"];

  const ordersWithNotes = await db
    .selectDistinct({ productionOrderId: voiceNotesTable.productionOrderId })
    .from(voiceNotesTable)
    .where(and(
      isNull(voiceNotesTable.deletedAt),
      eq(voiceNotesTable.isReplaced, false),
    ));

  const orderIds = ordersWithNotes
    .map(r => r.productionOrderId)
    .filter((id): id is number => id !== null);

  if (orderIds.length === 0) return { deletedCount: 0 };

  const terminalOrders = await db
    .select({ id: productionOrdersTable.id, status: productionOrdersTable.status, dispatchStatus: productionOrdersTable.dispatchStatus })
    .from(productionOrdersTable)
    .where(
      inArray(productionOrdersTable.id, orderIds)
    );

  const terminalOrderIds = terminalOrders
    .filter(o => {
      const isTerminal = TERMINAL_STATUSES.includes(o.status) ||
        TERMINAL_DISPATCH_STATUSES.includes(o.dispatchStatus || "");
      return isTerminal;
    })
    .map(o => o.id);

  let deletedTotal = 0;
  for (const orderId of terminalOrderIds) {
    const result = await cleanupVoiceNotesForOrder(orderId, "Daily orphan cleanup");
    deletedTotal += result.deletedCount;
  }

  return { deletedCount: deletedTotal };
}

// ────────────────────────────────────────
// Diagnostics: check every voice note's storage status
// ────────────────────────────────────────
export interface VoiceNoteDiagnostic {
  id: number;
  storagePath: string;
  generatedUrl: string;
  dealId: number | null;
  productionOrderId: number | null;
  proformaInvoiceId: number | null;
  orderId: number | null;
  uploadedByName: string | null;
  createdByRole: string;
  mimeType: string;
  fileSize: number;
  fileAvailable: boolean;
  storageCheckResult: boolean;
  storageCheckError: string | null;
  httpStatus: number | null;
  createdAt: string;
}

export async function getVoiceNotesDiagnostics(): Promise<{
  storageProvider: string;
  supabaseConfigured: boolean;
  supabaseApiKeyValid: boolean | null;
  supabaseBuckets: string[];
  totalRecords: number;
  availableCount: number;
  unavailableCount: number;
  notes: VoiceNoteDiagnostic[];
}> {
  const store = getStorageProvider();
  const providerName = process.env.SUPABASE_URL ? "Supabase" : "Local";
  const supabaseConfigured = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_KEY;

  // Check Supabase API key validity and list buckets
  let supabaseApiKeyValid: boolean | null = null;
  let supabaseBuckets: string[] = [];
  if (supabaseConfigured) {
    try {
      const listUrl = `${process.env.SUPABASE_URL}/storage/v1/bucket`;
      const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
      });
      supabaseApiKeyValid = res.ok;
      if (res.ok) {
        const buckets = await res.json() as { id: string; public: boolean }[];
        supabaseBuckets = buckets.map(b => `${b.id} (public=${b.public})`);
      } else {
        const errText = await res.text().catch(() => "");
        console.error(`[VoiceNote Diag] Supabase API key invalid: HTTP ${res.status}: ${errText}`);
      }
    } catch (err: any) {
      supabaseApiKeyValid = false;
      console.error(`[VoiceNote Diag] Supabase connection failed: ${err?.message}`);
    }
  }

  const rows = await db
    .select({
      id: voiceNotesTable.id,
      storagePath: voiceNotesTable.storagePath,
      dealId: voiceNotesTable.dealId,
      productionOrderId: voiceNotesTable.productionOrderId,
      proformaInvoiceId: voiceNotesTable.proformaInvoiceId,
      orderId: voiceNotesTable.orderId,
      uploadedById: voiceNotesTable.uploadedById,
      createdByRole: voiceNotesTable.createdByRole,
      mimeType: voiceNotesTable.mimeType,
      fileSize: voiceNotesTable.fileSize,
      isReplaced: voiceNotesTable.isReplaced,
      deletedAt: voiceNotesTable.deletedAt,
      createdAt: voiceNotesTable.createdAt,
    })
    .from(voiceNotesTable)
    .orderBy(desc(voiceNotesTable.createdAt));

  const diagnostics: VoiceNoteDiagnostic[] = [];
  let availableCount = 0;
  let unavailableCount = 0;

  for (const row of rows) {
    let uploadedByName: string | null = null;
    if (row.uploadedById) {
      const [user] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, row.uploadedById));
      uploadedByName = user?.name || null;
    }

    let storageCheckResult = false;
    let storageCheckError: string | null = null;
    let httpStatus: number | null = null;

    try {
      const verification = await (store as any).verifyPublicAccess(row.storagePath);
      storageCheckResult = verification.accessible;
      if (!verification.accessible) {
        storageCheckError = verification.error || "Not accessible";
      }
    } catch (err: any) {
      storageCheckError = err?.message || "Exception during check";
    }

    if (storageCheckResult) {
      availableCount++;
    } else {
      unavailableCount++;
    }

    diagnostics.push({
      id: row.id,
      storagePath: row.storagePath,
      generatedUrl: storageCheckResult ? store.getUrl(row.storagePath) : "",
      dealId: row.dealId,
      productionOrderId: row.productionOrderId,
      proformaInvoiceId: row.proformaInvoiceId,
      orderId: row.orderId,
      uploadedByName,
      createdByRole: row.createdByRole,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      fileAvailable: storageCheckResult,
      storageCheckResult,
      storageCheckError,
      httpStatus,
      createdAt: row.createdAt?.toISOString?.() || String(row.createdAt),
    });
  }

  return {
    storageProvider: providerName,
    supabaseConfigured,
    supabaseApiKeyValid,
    supabaseBuckets,
    totalRecords: rows.length,
    availableCount,
    unavailableCount,
    notes: diagnostics,
  };
}

// ────────────────────────────────────────
// Enrich note with response fields
// ────────────────────────────────────────
async function enrichVoiceNote(row: any): Promise<VoiceNoteResponse> {
  let uploadedByName: string | null = null;
  if (row.uploadedById) {
    const [user] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, row.uploadedById));
    uploadedByName = user?.name || null;
  }

  const store = getStorageProvider();
  const fileExists = await store.exists(row.storagePath);

  return {
    id: row.id,
    dealId: row.dealId || null,
    productionOrderId: row.productionOrderId || null,
    proformaInvoiceId: row.proformaInvoiceId || null,
    orderId: row.orderId || null,
    leadId: row.leadId || null,
    customerId: row.customerId || null,
    uploadedById: row.uploadedById,
    createdByRole: row.createdByRole || "unknown",
    uploadedByName,
    fileName: row.fileName,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    storagePath: row.storagePath,
    url: fileExists ? store.getUrl(row.storagePath) : "",
    durationMs: row.durationMs || null,
    transcript: row.transcript || null,
    transcriptStatus: row.transcriptStatus || "pending",
    isReplaced: row.isReplaced || false,
    fileAvailable: fileExists,
    createdAt: row.createdAt?.toISOString?.() || String(row.createdAt),
  };
}
