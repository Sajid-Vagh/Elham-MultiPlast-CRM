import { activitiesTable } from "@workspace/db";

/**
 * Activity types for PI lifecycle events.
 * Single source of truth — all modules use these constants.
 */
export const PI_ACTIVITY_TYPES = {
  PI_CREATED: "PI Created",
  PI_UPDATED: "PI Updated",
  PI_REVISED: "PI Revised",
  PI_SENT: "PI Sent",
  PI_APPROVED: "PI Approved",
  PI_REJECTED: "PI Rejected",
  PI_DELETED: "PI Deleted",
  PI_CONVERTED: "PI Converted",
  PI_MODIFIED_AFTER_PRODUCTION: "PI Modified After Production Complete",
  PI_MODIFIED_DURING_PRODUCTION: "PI Modified During Production",
  PI_SYNCED: "PI Synced to Production",
} as const;

/**
 * Activity types for Deal lifecycle events.
 */
export const DEAL_ACTIVITY_TYPES = {
  DEAL_WON: "Deal Won",
  DEAL_LOST: "Deal Lost",
  DEAL_STAGE_CHANGED: "Deal Stage Changed",
  DEAL_CREATED: "Deal Created",
} as const;

/**
 * Activity types for Production lifecycle events.
 */
export const PRODUCTION_ACTIVITY_TYPES = {
  ORDER_CREATED: "Production Order Created",
  ORDER_ACCEPTED: "Production Order Accepted",
  PLANNING_STARTED: "Planning Started",
  PRODUCTION_STARTED: "Production Started (Machine Running)",
  STATUS_CHANGED: "Production Status Changed",
  ORDER_TRANSFERRED: "Production Order Transferred",
  ORDER_DELAYED: "Production Order Delayed",
  ORDER_COMPLETED: "Production Completed",
  ORDER_CANCELLED: "Production Order Cancelled",
  PI_MODIFIED: "PI Modified During Production",
  PI_MODIFICATION_APPROVED: "PI Modification Approved",
  PI_MODIFICATION_REJECTED: "PI Modification Rejected",
  NOTE_ADDED: "Production Note Added",
} as const;

/**
 * Centralized activity logger.
 * Single function for creating activity log entries across all modules.
 *
 * @param exec - Database executor (db or tx)
 * @param params - Activity parameters
 */
export async function logActivity(
  exec: { insert: Function },
  params: {
    dealId?: number | null;
    contactId?: number | null;
    type: string;
    notes: string;
    createdBy: number;
  }
) {
  const { dealId, contactId, type, notes, createdBy } = params;

  // Only insert if we have at least a dealId or contactId
  if (!dealId && !contactId) return;

  await exec.insert(activitiesTable).values({
    dealId: dealId ?? null,
    contactId: contactId ?? null,
    type: "Note",
    notes,
    createdBy,
  });
}

/**
 * Format a timestamp for Indian locale.
 */
export function formatTimestamp(date?: Date): string {
  return (date || new Date()).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Log a PI activity with standard formatting.
 */
export async function logPiActivity(
  exec: { insert: Function },
  params: {
    dealId: number | null;
    contactId: number | null;
    eventName: string;
    invoiceNumber: string;
    details?: string;
    userName: string;
    createdBy: number;
    timestamp?: Date;
  }
) {
  const { dealId, contactId, eventName, invoiceNumber, details, userName, createdBy, timestamp } = params;
  if (!dealId) return;

  const ts = formatTimestamp(timestamp);
  const detailLines = details ? `\n\n${details}` : "";

  await logActivity(exec, {
    dealId,
    contactId,
    type: "Note",
    notes: `${eventName} — ${invoiceNumber}${detailLines}\n\nBy: ${userName}\n${ts}`,
    createdBy,
  });
}

/**
 * Log a deal stage change activity.
 */
export async function logDealStageActivity(
  exec: { insert: Function },
  params: {
    dealId: number;
    contactId: number;
    fromStage: string;
    toStage: string;
    userName: string;
    createdBy: number;
    extraNotes?: string;
  }
) {
  const { dealId, contactId, fromStage, toStage, userName, createdBy, extraNotes } = params;
  const ts = formatTimestamp();

  let activityNotes: string;
  if (toStage === "Lost" && extraNotes) {
    activityNotes = `Deal marked as Lost\n\nLost Reason: ${extraNotes}`;
  } else {
    activityNotes = `${userName} moved deal stage from "${fromStage}" to "${toStage}"\n\n${ts}`;
  }

  await logActivity(exec, {
    dealId,
    contactId,
    type: "Note",
    notes: activityNotes,
    createdBy,
  });
}
