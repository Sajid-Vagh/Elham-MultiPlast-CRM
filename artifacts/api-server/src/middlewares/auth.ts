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
      customers: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "sales", "support"], approve: ["admin"] },
      leads: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "sales"], approve: ["admin"] },
      pipeline: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "sales"], approve: ["admin"] },
      orders: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "sales", "support"], approve: ["admin", "sales"] },
      production: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "production_manager", "support"], approve: ["admin", "production_manager"] },
      dispatch: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "support", "production_manager"], approve: ["admin"] },
      complaints: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "support"], approve: ["admin"] },
      quotations: { view: ["admin", "sales", "support", "production_manager"], edit: ["admin", "sales"], approve: ["admin", "sales"] },
    };

    req.next?.();
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
