import { Router, type IRouter } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

// Get audit logs
router.get("/audit-logs", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const { entityType, entityId, changedBy, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
    if (entityId) conditions.push(eq(auditLogsTable.entityId, Number(entityId)));
    if (changedBy) conditions.push(eq(auditLogsTable.changedBy, Number(changedBy)));

    const where = conditions.length ? and(...conditions) : undefined;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogsTable).where(where);
    const logs = await db.select({
      id: auditLogsTable.id,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      action: auditLogsTable.action,
      oldValue: auditLogsTable.oldValue,
      newValue: auditLogsTable.newValue,
      changedBy: usersTable.name,
      department: auditLogsTable.department,
      role: auditLogsTable.role,
      reason: auditLogsTable.reason,
      ipAddress: auditLogsTable.ipAddress,
      createdAt: auditLogsTable.createdAt,
    }).from(auditLogsTable)
      .leftJoin(usersTable, eq(usersTable.id, auditLogsTable.changedBy))
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum);

    res.json({ data: logs, pagination: { page: pageNum, limit: limitNum, total: countResult?.count ?? 0, totalPages: Math.ceil((countResult?.count ?? 0) / limitNum) } });
  } catch (err) {
    console.error("Get audit logs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
