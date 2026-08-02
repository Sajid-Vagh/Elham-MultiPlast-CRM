import { db, voiceNotesTable, ordersTable } from "@workspace/db";
import { eq, and, inArray, isNull, lt, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getStorageProvider } from "./storage";

/**
 * Retention policy for voice notes attached to Sales Orders.
 * Once an order has been marked 'Delivered' or 'Completed', the audio files
 * are kept for RETENTION_DAYS (measured from the order's last update) and then
 * permanently removed from storage.
 */
const RETENTION_DAYS = 90;

/** Terminal order statuses that start the 90-day countdown. */
const TERMINAL_ORDER_STATUSES = ["Delivered", "Completed"] as const;

export interface VoiceNoteCleanupResult {
  scanned: number; // voice notes found that matched the retention criteria
  purged: number;  // rows updated (file removed, metadata kept)
  storageDeleted: number; // physical files successfully removed from storage
  failed: number;  // rows that could not be updated
}

/**
 * Delete the physical audio of voice notes attached to orders that were
 * 'Delivered'/'Completed' more than 90 days ago.
 *
 * - The database ROW is never deleted (transcript + metadata are historical data).
 * - The physical file is removed from Supabase Storage via storage.delete().
 * - The row is updated: storage_path = NULL, file_data = NULL,
 *   file_available = false, file_deleted_at = NOW().
 */
export async function cleanupDeliveredOrderVoiceNotes(): Promise<VoiceNoteCleanupResult> {
  const result: VoiceNoteCleanupResult = { scanned: 0, purged: 0, storageDeleted: 0, failed: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // 1. Orders that reached a terminal status long enough ago (updatedAt is bumped
  //    on every status change, so it reflects when the order became terminal).
  const oldOrders = await db
    .select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.status, [...TERMINAL_ORDER_STATUSES]),
        lt(ordersTable.updatedAt, cutoff),
        eq(ordersTable.isDeleted, false),
      ),
    );

  if (oldOrders.length === 0) {
    logger.info({ retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString() }, "Voice note cleanup: no eligible orders");
    return result;
  }

  const orderIds = oldOrders.map(o => o.id);
  const orderNumberById = new Map(oldOrders.map(o => [o.id, o.orderNumber]));

  // 2. Voice notes attached to those orders that still carry a file.
  const notes = await db
    .select({
      id: voiceNotesTable.id,
      orderId: voiceNotesTable.orderId,
      storagePath: voiceNotesTable.storagePath,
      fileName: voiceNotesTable.fileName,
      hasFileData: sql<boolean>`(${voiceNotesTable.fileData} IS NOT NULL)`,
    })
    .from(voiceNotesTable)
    .where(
      and(
        inArray(voiceNotesTable.orderId, orderIds),
        isNull(voiceNotesTable.fileDeletedAt), // never purged before
        isNull(voiceNotesTable.deletedAt),     // not manually soft-deleted
      ),
    );

  result.scanned = notes.length;
  if (notes.length === 0) {
    logger.info({ orders: orderIds.length }, "Voice note cleanup: no voice notes to purge");
    return result;
  }

  const store = getStorageProvider();

  for (const note of notes) {
    try {
      // 3. Remove the physical file from Supabase Storage (best effort — the
      //    DELETE endpoint returns false when the object no longer exists).
      let storageDeleted = false;
      if (note.storagePath) {
        storageDeleted = await store.delete(note.storagePath);
        if (!storageDeleted) {
          logger.warn(
            { voiceNoteId: note.id, orderId: note.orderId, storagePath: note.storagePath },
            "Voice note file not found in storage (or already deleted) — proceeding to clear DB bytes",
          );
        }
      }

      // 4. Update the row (never delete it). The actual audio bytes for notes
      //    stored in the DB (file_data) are cleared here to free database space.
      await db
        .update(voiceNotesTable)
        .set({
          storagePath: null,
          fileData: null,
          fileAvailable: false,
          fileDeletedAt: new Date(),
        })
        .where(eq(voiceNotesTable.id, note.id));

      result.purged++;
      if (storageDeleted) result.storageDeleted++;

      logger.info(
        {
          voiceNoteId: note.id,
          orderId: note.orderId,
          orderNumber: orderNumberById.get(note.orderId ?? -1),
          storageDeleted,
          hasFileData: note.hasFileData,
          fileName: note.fileName,
        },
        "Voice note audio purged (row retained)",
      );
    } catch (err) {
      result.failed++;
      logger.error(
        { err, voiceNoteId: note.id, orderId: note.orderId },
        "Voice note cleanup failed for row",
      );
    }
  }

  logger.info(
    {
      scanned: result.scanned,
      purged: result.purged,
      storageDeleted: result.storageDeleted,
      failed: result.failed,
    },
    "Voice note cleanup completed",
  );

  return result;
}
