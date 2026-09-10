import { db, proformaInvoicesTable, proformaInvoiceItemsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export const VALID_WON_PI_STATUSES = [
  "sent",
  "viewed",
  "approved",
  "converted to order",
  "converted to production",
] as const;

/**
 * Check if a PI status is considered valid for marking a deal as Won.
 * Matches case-insensitively and trims whitespace.
 */
export function isValidPiStatusForWon(status: string | null | undefined): boolean {
  if (!status) return false;
  return VALID_WON_PI_STATUSES.includes(status.trim().toLowerCase() as any);
}

/**
 * Single source of truth for fetching the active / most relevant Proforma Invoice for a deal.
 *
 * Handles:
 * 1. Deals with multiple PI versions (picks active first, then latest version & id)
 * 2. Deals where isActive flag wasn't set or maintained (legacy data)
 * 3. Array results from database queries
 *
 * Returns the active PI record, or null if none exists.
 * Every module (Deals, Production, Reports, Dashboard) must use this helper.
 */
export async function getActivePiForDeal(
  exec: { select: Function },
  dealId: number
): Promise<typeof proformaInvoicesTable.$inferSelect | null> {
  const pis: (typeof proformaInvoicesTable.$inferSelect)[] = await exec
    .select()
    .from(proformaInvoicesTable)
    .where(and(
      eq(proformaInvoicesTable.dealId, dealId),
      eq(proformaInvoicesTable.isDeleted, false),
    ))
    .orderBy(
      desc(proformaInvoicesTable.isActive),
      desc(proformaInvoicesTable.version),
      desc(proformaInvoicesTable.id)
    );

  if (!pis || !Array.isArray(pis) || pis.length === 0) return null;

  // 1. Prefer active PI with a valid sent/approved status
  const activeValid = pis.find(p => p.isActive && isValidPiStatusForWon(p.status));
  if (activeValid) return activeValid;

  // 2. Prefer any active PI (e.g. latest active version)
  const activePi = pis.find(p => p.isActive);
  if (activePi) return activePi;

  // 3. Fallback: if no active flag found (legacy data), prefer latest valid sent/approved PI
  const validPi = pis.find(p => isValidPiStatusForWon(p.status));
  if (validPi) return validPi;

  // 4. Fallback to latest non-deleted PI
  return pis[0] ?? null;
}

/**
 * Get active PI summary (lightweight) for deal enrichment.
 */
export async function getActivePiSummary(
  exec: { select: Function },
  dealId: number
) {
  const pis = await exec
    .select({
      id: proformaInvoicesTable.id,
      invoiceNumber: proformaInvoicesTable.invoiceNumber,
      status: proformaInvoicesTable.status,
      taxableAmount: proformaInvoicesTable.taxableAmount,
      grandTotal: proformaInvoicesTable.grandTotal,
      version: proformaInvoicesTable.version,
      isActive: proformaInvoicesTable.isActive,
      createdAt: proformaInvoicesTable.createdAt,
    })
    .from(proformaInvoicesTable)
    .where(and(
      eq(proformaInvoicesTable.dealId, dealId),
      eq(proformaInvoicesTable.isDeleted, false),
    ))
    .orderBy(
      desc(proformaInvoicesTable.isActive),
      desc(proformaInvoicesTable.version),
      desc(proformaInvoicesTable.id)
    );

  if (!pis || !Array.isArray(pis) || pis.length === 0) return null;

  const activeValid = pis.find((p: any) => p.isActive && isValidPiStatusForWon(p.status));
  if (activeValid) return activeValid;

  const activePi = pis.find((p: any) => p.isActive);
  if (activePi) return activePi;

  const validPi = pis.find((p: any) => isValidPiStatusForWon(p.status));
  if (validPi) return validPi;

  return pis[0] ?? null;
}

/**
 * Validate that an active PI exists and is in a valid status for Won.
 * Returns the validated PI or throws a descriptive error string.
 */
export async function validateActivePiForWon(
  exec: { select: Function },
  dealId: number
): Promise<{ valid: true; pi: typeof proformaInvoicesTable.$inferSelect; taxableAmount: number } | { valid: false; error: string }> {
  const pi = await getActivePiForDeal(exec, dealId);
  if (!pi) {
    return { valid: false, error: "No Proforma Invoice found for this Deal. Create and send a PI before marking as Won." };
  }
  if (!isValidPiStatusForWon(pi.status)) {
    return { valid: false, error: `Proforma Invoice must be "Sent" or "Approved" before marking as Won. Current status: "${pi.status}". Send the PI to the customer first.` };
  }
  const taxableAmount = Number(pi.taxableAmount || 0);
  if (taxableAmount <= 0) {
    const grandTotal = Number(pi.grandTotal || 0);
    if (grandTotal > 0) {
      return { valid: true, pi, taxableAmount: grandTotal };
    }
    return { valid: false, error: "Proforma Invoice has no subtotal (taxable amount). Update the PI before marking as Won." };
  }
  return { valid: true, pi, taxableAmount };
}

/**
 * Validate that an active PI exists for the PI Sent stage.
 */
export async function validateActivePiForPiSent(
  exec: { select: Function },
  dealId: number
): Promise<{ valid: true } | { valid: false; error: string }> {
  const pi = await getActivePiForDeal(exec, dealId);
  if (!pi) {
    return { valid: false, error: "No Proforma Invoice found for this Deal. Create a PI before moving to PI Sent." };
  }
  return { valid: true };
}

/**
 * Deactivate all active PIs for a deal (used when creating a new version).
 */
export async function deactivateActivePis(
  exec: { update: Function },
  dealId: number
) {
  await exec.update(proformaInvoicesTable)
    .set({ isActive: false })
    .where(and(
      eq(proformaInvoicesTable.dealId, dealId),
      eq(proformaInvoicesTable.isActive, true),
      eq(proformaInvoicesTable.isDeleted, false),
    ));
}

/**
 * Get next version number for a deal.
 */
export async function getNextPiVersion(
  exec: { select: Function },
  dealId: number
): Promise<number> {
  const [lastVersion] = await exec
    .select({ version: proformaInvoicesTable.version })
    .from(proformaInvoicesTable)
    .where(and(eq(proformaInvoicesTable.dealId, dealId), eq(proformaInvoicesTable.isDeleted, false)))
    .orderBy(desc(proformaInvoicesTable.version))
    .limit(1);
  return (lastVersion?.version || 0) + 1;
}

/**
 * Fetch PI items for a given invoice.
 */
export async function getPiItems(
  exec: { select: Function },
  invoiceId: number
) {
  return exec
    .select()
    .from(proformaInvoiceItemsTable)
    .where(eq(proformaInvoiceItemsTable.invoiceId, invoiceId));
}
