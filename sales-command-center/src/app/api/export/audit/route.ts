import { getActor } from "@/server/auth";
import { can } from "@/server/policy";
import { getSettings } from "@/server/settings";
import { prisma } from "@/server/db";
import { auditWhere } from "@/server/services/auditQuery";
import { csvResponse, toCsv } from "@/lib/csv";
import { fmtDateTime, resolveRange } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "audit.view")) return Response.json({ error: "Only the coordinator can export the audit log." }, { status: 403 });
  const tz = (await getSettings()).timezone;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const range = resolveRange(params.range ?? "all", params.from, params.to, tz);
  const rows = await prisma.auditLog.findMany({ where: auditWhere(params, range), include: { actor: { select: { name: true } }, lead: { select: { businessName: true, leadNumber: true } } }, orderBy: { createdAt: "desc" }, take: 50000 });
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.audit", entityType: "AuditLog", summary: `Exported ${rows.length} audit entries to CSV (${range.label})` } });
  return csvResponse(
    toCsv(rows, [
      { header: "When", value: (r) => fmtDateTime(r.createdAt, tz) },
      { header: "Timestamp (UTC)", value: (r) => r.createdAt.toISOString() },
      { header: "Who", value: (r) => r.actor?.name ?? "System" },
      { header: "Action", value: (r) => r.action },
      { header: "Summary", value: (r) => r.summary },
      { header: "Lead", value: (r) => (r.lead ? `#${r.lead.leadNumber} ${r.lead.businessName}` : "") },
      { header: "Details", value: (r) => (r.data ? JSON.stringify(r.data) : "") },
    ]),
    `audit-log-${range.preset === "all" ? "all" : `${range.startKey}-to-${range.endKey}`}.csv`,
  );
}
