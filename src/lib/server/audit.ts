import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "./db";

export async function audit(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  summary: string,
  details?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({ data: { action, entityType, entityId, summary, details } });
}
