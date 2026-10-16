import { can } from "@/server/policy";
import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listVisits } from "@/server/services/visitQuery";
import { prisma } from "@/server/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { INTEREST_LABEL, VISIT_OUTCOME_LABEL, VISIT_TYPE_LABEL } from "@/lib/labels";
import { fmtDateTime, resolveRange, visitDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "data.export")) return Response.json({ error: "Only the coordinator can export data." }, { status: 403 });
  const tz = (await getSettings()).timezone;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const range = resolveRange(params.range ?? "month", params.from, params.to, tz);
  const visits = await listVisits(actor, params, range, 20000);
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.visits", entityType: "Visit", summary: `Exported ${visits.length} visit(s) to CSV (${range.label})` } });
  return csvResponse(
    toCsv(visits, [
      { header: "Visit date", value: (v) => visitDateTime(v, tz) },
      { header: "Business", value: (v) => v.lead.businessName },
      { header: "Area", value: (v) => v.lead.area?.name },
      { header: "Rep", value: (v) => v.rep.name },
      { header: "Type", value: (v) => VISIT_TYPE_LABEL[v.type] },
      { header: "Outcome", value: (v) => VISIT_OUTCOME_LABEL[v.outcome] },
      { header: "Spoke with", value: (v) => v.contactEncountered },
      { header: "Interest", value: (v) => (v.interestLevel ? INTEREST_LABEL[v.interestLevel] : "") },
      { header: "Feedback", value: (v) => v.feedback },
      { header: "Objections", value: (v) => v.objections },
      { header: "Follow-up", value: (v) => v.followUpAction },
      { header: "Follow-up due", value: (v) => (v.followUpDueAt ? fmtDateTime(v.followUpDueAt, tz) : "") },
      { header: "Notes", value: (v) => v.notes },
      { header: "Recorded", value: (v) => fmtDateTime(v.createdAt, tz) },
    ]),
    `visits-${range.startKey}-to-${range.endKey}.csv`,
  );
}
