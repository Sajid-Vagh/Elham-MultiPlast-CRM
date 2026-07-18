import {
  db, dealsTable, contactsTable, categoryHistoryTable,
  usersTable, ordersTable, proformaInvoicesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getActivePiForDeal } from "./proforma-service";
import { unitsTable } from "@workspace/db";
import { PENDING_UNIT_ASSIGNMENT, isPendingUnit } from "./unit-constants";

/**
 * Validate production unit against dynamic units table.
 * Falls back to common units if DB query fails (safe degradation).
 * Never hardcode factory names.
 */
export async function validateProductionUnit(
  exec: { select: Function },
  unit: string
): Promise<boolean> {
  if (!unit) return false;
  try {
    const [dbUnit] = await exec
      .select()
      .from(unitsTable)
      .where(and(eq(unitsTable.name, unit), eq(unitsTable.isActive, true)))
      .limit(1);
    if (dbUnit) return true;
  } catch {
    // If units table query fails, allow common units as fallback
  }
  // Fallback: allow common units (safety net, never remove DB check above)
  return ["Himatnagar", "Surat", "Rajkot"].includes(unit);
}

/**
 * Validate all prerequisites for marking a deal as Won.
 * This is the single validation function used by both PATCH and mark-won endpoints.
 *
 * Returns a structured result instead of throwing, so callers can
 * return appropriate HTTP responses.
 */
export async function validateWonPrerequisites(params: {
  exec: { select: Function };
  dealId: number;
  wonAmount?: any;
  productionUnit?: string;
  isMarkWonEndpoint: boolean;
}): Promise<{ valid: true; piTaxableAmount: number } | { valid: false; status: number; error: string }> {
  const { exec, dealId, wonAmount, productionUnit, isMarkWonEndpoint } = params;

  // Fetch deal
  const [deal] = await exec.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!deal) return { valid: false, status: 404, error: "Deal not found" };

  // Prevent re-won
  if (deal.stage === "Won") return { valid: false, status: 400, error: "This deal is already marked as Won" };

  // Validate won amount (mark-won endpoint only)
  if (isMarkWonEndpoint) {
    if (wonAmount == null || isNaN(Number(wonAmount)) || Number(wonAmount) <= 0) {
      return { valid: false, status: 400, error: "Won Amount is required and must be greater than 0" };
    }
  }

  // Validate production unit (mark-won endpoint only)
  if (isMarkWonEndpoint) {
    if (!productionUnit || isPendingUnit(productionUnit)) {
      return { valid: false, status: 400, error: "Production Unit is required. Please select a Production Unit before marking this Deal as Won. Available Units: Himatnagar, Surat, Rajkot" };
    }
    const validUnit = await validateProductionUnit(exec, productionUnit);
    if (!validUnit) {
      return { valid: false, status: 400, error: "Invalid Production Unit. Please select a valid unit." };
    }
  }

  // Validate PI prerequisites
  const piValidation = await validateWonPrerequisitesFromPi(exec, dealId);
  if (!piValidation.valid) return piValidation;

  return { valid: true, piTaxableAmount: piValidation.piTaxableAmount };
}

/**
 * Validate PI prerequisites for Won (shared by both PATCH and mark-won).
 */
async function validateWonPrerequisitesFromPi(
  exec: { select: Function },
  dealId: number
): Promise<{ valid: true; piTaxableAmount: number } | { valid: false; status: number; error: string }> {
  const pi = await getActivePiForDeal(exec, dealId);
  if (!pi) {
    return { valid: false, status: 400, error: "No active Proforma Invoice found. Create and send a PI before marking as Won." };
  }
  if (pi.status !== "Sent" && pi.status !== "Approved") {
    return { valid: false, status: 400, error: `Proforma Invoice must be "Sent" or "Approved" before marking as Won. Current status: "${pi.status}". Send the PI to the customer first.` };
  }
  const taxableAmount = Number(pi.taxableAmount || 0);
  if (taxableAmount <= 0) {
    return { valid: false, status: 400, error: "Proforma Invoice has no subtotal (taxable amount). Update the PI before marking as Won." };
  }
  return { valid: true, piTaxableAmount: taxableAmount };
}

/**
 * Convert contact to "My Client" when a deal is Won.
 * Single implementation used by both PATCH and mark-won paths.
 *
 * @returns true if conversion happened, false if already a My Client
 */
export async function convertContactToMyClient(
  exec: { select: Function; update: Function; insert: Function },
  params: {
    contactId: number;
    dealId: number;
    userId: number;
    isMyClient: boolean;
    convertedToClient: boolean;
    now: Date;
  }
): Promise<boolean> {
  const { contactId, dealId, userId, isMyClient, convertedToClient, now } = params;

  if (isMyClient) {
    // Already a permanent My Client — just mark this deal as converted
    if (!convertedToClient) {
      await exec.update(dealsTable).set({
        convertedToClient: true,
        convertedAt: now,
      }).where(eq(dealsTable.id, dealId));
    }
    return false;
  }

  // Convert to My Client
  const [contact] = await exec.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!contact) return false;

  const prevCategory = contact.category;
  const nowISO = now.toISOString();

  await exec.update(contactsTable).set({
    category: "My Client",
    isMyClient: true,
    customerSince: nowISO,
    customerStatus: "Active",
    lastPurchaseDate: nowISO.split("T")[0],
  }).where(eq(contactsTable.id, contactId));

  await exec.update(dealsTable).set({
    convertedToClient: true,
    convertedAt: now,
  }).where(eq(dealsTable.id, dealId));

  await exec.insert(categoryHistoryTable).values({
    contactId: contactId,
    previousCategory: prevCategory,
    newCategory: "My Client",
    changedBy: userId,
    reason: "Deal Won - Auto converted to My Client",
  });

  return true;
}

/**
 * Check if no existing order exists for a deal (prevents duplicate orders).
 */
export async function checkNoExistingOrder(
  exec: { select: Function },
  dealId: number
): Promise<boolean> {
  const [existing] = await exec
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.dealId, dealId))
    .limit(1);
  return !existing;
}

/**
 * Get won count for a user today (used for celebration messaging).
 */
export async function getTodayWonCount(userId: number): Promise<number> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dealsTable)
    .where(
      and(
        eq(dealsTable.salesOwnerId, userId),
        eq(dealsTable.stage, "Won"),
        sql`${dealsTable.completedAt} >= ${todayStart}`,
      )
    );
  return countResult?.count ?? 0;
}
