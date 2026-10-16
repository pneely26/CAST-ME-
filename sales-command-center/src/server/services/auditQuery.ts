import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { assertCan, type Actor } from "../policy";
import { sp, type SP } from "./leadQuery";
import type { DateRange } from "@/lib/time";

export const AUDIT_AREAS: Record<string, { label: string; prefix: string[] }> = {
  leads: { label: "Leads", prefix: ["lead."] },
  visits: { label: "Visits", prefix: ["visit."] },
  followups: { label: "Follow-ups", prefix: ["followup."] },
  territories: { label: "Territories & areas", prefix: ["territory.", "area."] },
  appointments: { label: "Appointments & reschedules", prefix: ["appointment.", "reschedule."] },
  schedule: { label: "Schedule", prefix: ["schedule.", "dayplan.", "template."] },
  sales: { label: "Sales", prefix: ["opportunity."] },
  imports: { label: "Imports", prefix: ["import."] },
  users: { label: "Users & settings", prefix: ["user.", "settings.", "demo."] },
  exports: { label: "Exports", prefix: ["export."] },
};

export function auditWhere(params: SP, range: DateRange): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (range.preset !== "all") and.push({ createdAt: { gte: range.start, lt: range.end } });
  const actor = sp(params, "actor");
  if (actor) and.push({ actorId: actor === "system" ? null : actor });
  const area = sp(params, "area");
  if (area && AUDIT_AREAS[area]) and.push({ OR: AUDIT_AREAS[area].prefix.map((p) => ({ action: { startsWith: p } })) });
  const q = sp(params, "q");
  if (q) and.push({ summary: { contains: q, mode: "insensitive" } });
  return { AND: and };
}

/** Coordinator-only: every recorded change, newest first. */
export async function listAudit(actor: Actor, params: SP, range: DateRange, opts: { page?: number; pageSize?: number } = {}) {
  assertCan(actor, "audit.view", "Only the coordinator can view the audit log.");
  const where = auditWhere(params, range);
  const pageSize = opts.pageSize ?? 100;
  const page = Math.max(1, opts.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { name: true } }, lead: { select: { id: true, businessName: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
