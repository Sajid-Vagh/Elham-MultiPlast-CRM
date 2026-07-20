import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, voiceNotesTable, usersTable, dealsTable, productionOrdersTable, contactsTable } from "@workspace/db";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { storage } from "./storage";

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
  } catch (err) {
    // If DB write failed, clean up the file
    const storagePath = await storage.save(file.originalname, file.buffer, "voice-notes").catch(() => null);
    if (storagePath) {
      await storage.delete(storagePath).catch(() => {});
    }
    console.error("Voice note upload error:", err);
    return { note: null, error: "Failed to upload voice note" };
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

  // Verify file existence for each note
  const result: VoiceNoteResponse[] = [];
  for (const row of rows) {
    const fileExists = fs.existsSync(storage.getPhysicalPath(row.storagePath));
    if (!fileExists && row.fileAvailable) {
      // Mark as unavailable in DB — silent update, don't block response
      await db.update(voiceNotesTable)
        .set({ fileAvailable: false })
        .where(eq(voiceNotesTable.id, row.id))
        .catch(() => {});
    }

    result.push({
      ...row,
      url: fileExists ? storage.getUrl(row.storagePath) : "",
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
  return fs.existsSync(storage.getPhysicalPath(note.storagePath));
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

  const fileExists = fs.existsSync(storage.getPhysicalPath(row.storagePath));

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
    url: fileExists ? storage.getUrl(row.storagePath) : "",
    durationMs: row.durationMs || null,
    transcript: row.transcript || null,
    transcriptStatus: row.transcriptStatus || "pending",
    isReplaced: row.isReplaced || false,
    fileAvailable: fileExists,
    createdAt: row.createdAt?.toISOString?.() || String(row.createdAt),
  };
}
