/**
 * Centralized permission checking helpers.
 * Single source of truth for role-based and ownership-based access control.
 */

export interface PermissionUser {
  id: number;
  role: string;
  name?: string;
  unit?: string | null;
}

/**
 * Check if a sales user can access a specific resource.
 * Sales users can only access their own resources.
 *
 * @returns true if access is allowed, false otherwise
 */
export function canAccessSalesResource(
  user: PermissionUser,
  resourceOwnerId: number | null | undefined
): boolean {
  if (user.role === "sales") {
    return resourceOwnerId === user.id;
  }
  return true;
}

/**
 * Check if a user has admin role.
 */
export function isAdmin(user: PermissionUser): boolean {
  return user.role === "admin";
}

/**
 * Check if a user has production role (any production-related role).
 */
export function isProductionUser(user: PermissionUser): boolean {
  return user.role === "production" || user.role === "production_and_support";
}

/**
 * Check if a user can access the production module.
 */
export function canAccessProduction(user: PermissionUser): boolean {
  return isAdmin(user) || isProductionUser(user);
}

/**
 * Check if a user can modify a deal.
 * Sales can only modify their own deals.
 */
export function canModifyDeal(
  user: PermissionUser,
  dealSalesOwnerId: number | null | undefined
): boolean {
  return canAccessSalesResource(user, dealSalesOwnerId);
}

/**
 * Check if a user can modify a Proforma Invoice.
 * Sales can only modify PIs they created.
 */
export function canModifyInvoice(
  user: PermissionUser,
  invoiceCreatedBy: number
): boolean {
  return canAccessSalesResource(user, invoiceCreatedBy);
}

/**
 * Check if a user can delete a Proforma Invoice.
 * Currently all users can delete (soft-delete).
 */
export function canDeleteInvoice(
  _user: PermissionUser,
  _invoiceCreatedBy: number
): boolean {
  return true;
}

/**
 * Check if a user can transfer a production order.
 * Only production, production_and_support, and admin can transfer.
 * Sales cannot.
 */
export function canTransferProductionOrder(user: PermissionUser): boolean {
  return isAdmin(user) || isProductionUser(user);
}

/**
 * Check if a user can modify production planning or status.
 * Sales users are view-only.
 * Production users can only modify orders in their unit.
 */
export function canModifyProduction(user: PermissionUser): boolean {
  return isAdmin(user) || isProductionUser(user);
}

/**
 * Check if a user can view production data.
 */
export function canViewProduction(user: PermissionUser): boolean {
  return true;
}

/**
 * Check if a user can manage inventory (create, edit, delete, adjust).
 * Only admin and inventory roles can manage. Sales and production are read-only.
 */
export function canManageInventory(user: PermissionUser): boolean {
  return user.role === "admin" || user.role === "inventory";
}

/**
 * Check if a user can cancel orders.
 * Permission matrix:
 * - admin: anytime (except completed)
 * - sales: before production starts, own orders only
 * - production: before Machine Running
 * - production_and_support: anytime with reason
 */
export function canCancelOrder(user: PermissionUser): boolean {
  return user.role === "admin" || user.role === "sales" || isProductionUser(user);
}

/**
 * Check if a user can create or update complaints.
 * Inventory users are read-only.
 */
export function canManageComplaints(user: PermissionUser): boolean {
  return user.role !== "inventory";
}

/**
 * Check if user's unit matches the resource's unit.
 * Used for unit-level data isolation enforcement on the backend.
 * Returns true if access is allowed (admin/All always allowed).
 */
export function canAccessUnit(
  user: PermissionUser,
  resourceUnit: string | null | undefined,
): boolean {
  if (user.role === "admin") return true;
  const userUnit = user.unit || "All";
  if (userUnit === "All") return true;
  if (!resourceUnit) return true; // No unit constraint on resource
  return userUnit === resourceUnit;
}

/**
 * Check if a user can manage transport/packing masters (create, edit).
 * Admin and inventory roles can manage. Sales and production are view-only.
 */
export function canManageMaster(user: PermissionUser): boolean {
  return user.role === "admin" || user.role === "inventory";
}

/**
 * Check if a user can import master data.
 * Admin and inventory roles only.
 */
export function canImportMaster(user: PermissionUser): boolean {
  return user.role === "admin" || user.role === "inventory";
}

/**
 * Check if a user can delete master import records.
 * Admin only.
 */
export function canUndoImport(user: PermissionUser): boolean {
  return user.role === "admin";
}
