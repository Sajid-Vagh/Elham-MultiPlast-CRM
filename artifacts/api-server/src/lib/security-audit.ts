import { db, auditLogsTable } from "@workspace/db";

interface SecurityAuditEvent {
  entityType: string;
  entityId: number;
  action: string;
  newValue?: Record<string, any>;
  changedBy?: number;
  ipAddress?: string;
}

export async function logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      newValue: event.newValue || {},
      changedBy: event.changedBy,
      department: "security",
      role: undefined,
      ipAddress: event.ipAddress,
    });
  } catch (err) {
    // Never let audit logging failures break the main flow
    console.error("Security audit log error:", err);
  }
}
