import { type Request, type Response, type NextFunction } from "express";
import { getUserFromRequest } from "../routes/auth";

export type AuthUser = {
  id: number;
  name: string;
  username: string;
  role: string;
  unit: string;
  colorCode: string;
  canViewAllReports: boolean;
  canAssignLeads: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { passwordHash: _, ...safeUser } = user;
  req.user = safeUser as AuthUser;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function requirePermission(permission: "view" | "edit" | "approve") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const role = req.user.role;

    const permissionMatrix: Record<string, Record<string, string[]>> = {
      customers: { view: ["admin", "sales", "production_and_support"], edit: ["admin", "sales", "production_and_support"], approve: ["admin"] },
      leads: { view: ["admin", "sales"], edit: ["admin", "sales"], approve: ["admin"] },
      pipeline: { view: ["admin", "sales"], edit: ["admin", "sales"], approve: ["admin"] },
      orders: { view: ["admin", "sales", "production_and_support"], edit: ["admin", "sales", "production_and_support"], approve: ["admin", "sales"] },
      production: { view: ["admin", "production", "production_and_support"], edit: ["admin", "production", "production_and_support"], approve: ["admin", "production"] },
      dispatch: { view: ["admin", "production_and_support"], edit: ["admin", "production_and_support"], approve: ["admin"] },
      complaints: { view: ["admin", "production_and_support"], edit: ["admin", "production_and_support"], approve: ["admin"] },
      quotations: { view: ["admin", "sales"], edit: ["admin", "sales"], approve: ["admin", "sales"] },
    };

    const routePermission = (req as any).routePermission as string | undefined;
    const resource = routePermission ?? "orders";
    const allowed = permissionMatrix[resource]?.[permission];

    if (!allowed || !allowed.includes(role)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }

    next();
  };
}

export async function logAudit(
  entityType: string,
  entityId: number,
  action: string,
  oldValue: any,
  newValue: any,
  userId: number,
  department?: string,
  role?: string,
  reason?: string,
  ipAddress?: string
) {
  const { db, auditLogsTable } = await import("@workspace/db");
  await db.insert(auditLogsTable).values({
    entityType,
    entityId,
    action,
    oldValue: oldValue ? JSON.stringify(oldValue) : null,
    newValue: newValue ? JSON.stringify(newValue) : null,
    changedBy: userId,
    department,
    role,
    reason,
    ipAddress,
  });
}
