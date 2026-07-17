import { db, proformaInvoicesTable, proformaInvoiceItemsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

/**
 * Single source of truth for fetching the active Proforma Invoice for a deal.
 *
 * Returns the active PI record, or null if none exists.
 * Every module (Deals, Production, Reports, Dashboard) must use this helper.
 */
export async function getActivePiForDeal(
  exec: { select: Function },
  dealId: number
): Promise<typeof proformaInvoicesTable.$inferSelect | null> {
  const [pi] = await exec
    .select()
    .from(proformaInvoicesTable)
    .where(and(
      eq(proformaInvoicesTable.dealId, dealId),
      eq(proformaInvoicesTable.isActive, true),
      eq(proformaInvoicesTable.isDeleted, false),
    ))
    .limit(1);
  return pi ?? null;
}

/**
 * Get active PI summary (lightweight) for deal enrichment.
 */
export async function getActivePiSummary(
  exec: { select: Function },
  dealId: number
) {
  const [pi] = await exec
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
      eq(proformaInvoicesTable.isActive, true),
      eq(proformaInvoicesTable.isDeleted, false),
    ))
    .limit(1);
  return pi ?? null;
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
    return { valid: false, error: "No active Proforma Invoice found. Create and send a PI before marking as Won." };
  }
  if (pi.status !== "Sent" && pi.status !== "Approved") {
    return { valid: false, error: `Proforma Invoice must be "Sent" or "Approved" before marking as Won. Current status: "${pi.status}". Send the PI to the customer first.` };
  }
  const taxableAmount = Number(pi.taxableAmount || 0);
  if (taxableAmount <= 0) {
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
    return { valid: false, error: "No active Proforma Invoice found for this Deal. Create a PI before moving to PI Sent." };
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
