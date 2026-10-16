import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listLeads } from "@/server/services/leadQuery";
import { prisma } from "@/server/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { LEAD_STATUS_LABEL, PRIORITY_LABEL, VISIT_OUTCOME_LABEL } from "@/lib/labels";
import { dateKeyInTz, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Exports exactly the leads the current user may see, with the same filters as the list. */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getSettings();
  const tz = settings.timezone;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const { rows } = await listLeads(actor, params, settings, { all: true });
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.leads", entityType: "Lead", summary: `Exported ${rows.length} lead(s) to CSV` } });
  const d = (x: Date | null) => (x ? fmtDateTime(x, tz) : "");
  const csv = toCsv(rows, [
    { header: "Lead ID", value: (l) => `L-${l.leadNumber}` },
    { header: "Business", value: (l) => l.businessName },
    { header: "Contact", value: (l) => l.contactName },
    { header: "Job title", value: (l) => l.jobTitle },
    { header: "Phone", value: (l) => l.phone },
    { header: "Email", value: (l) => l.email },
    { header: "Address", value: (l) => l.address },
    { header: "City", value: (l) => l.city },
    { header: "State", value: (l) => l.state },
    { header: "ZIP", value: (l) => l.zip },
    { header: "Territory", value: (l) => l.territory?.name },
    { header: "Area", value: (l) => l.area?.name },
    { header: "Source", value: (l) => l.source },
    { header: "Industry", value: (l) => l.industry },
    { header: "Assigned rep", value: (l) => l.assignedRep?.name },
    { header: "Priority", value: (l) => PRIORITY_LABEL[l.priority] },
    { header: "Status", value: (l) => LEAD_STATUS_LABEL[l.status] },
    { header: "Created", value: (l) => d(l.createdAt) },
    { header: "Last visit", value: (l) => d(l.lastVisitAt) },
    { header: "Last contact", value: (l) => d(l.lastContactAt) },
    { header: "Last outcome", value: (l) => (l.lastVisitOutcome ? VISIT_OUTCOME_LABEL[l.lastVisitOutcome] : "") },
    { header: "Latest feedback", value: (l) => l.latestFeedback },
    { header: "Visits", value: (l) => l.visitCount },
    { header: "Next follow-up", value: (l) => d(l.nextFollowUpAt) },
    { header: "Next appointment", value: (l) => d(l.nextAppointmentAt) },
    { header: "Estimated value", value: (l) => (l.estimatedValue ? String(l.estimatedValue) : "") },
    { header: "Tags", value: (l) => l.tags.join("; ") },
    { header: "Notes", value: (l) => l.notes },
    { header: "Archived", value: (l) => (l.archivedAt ? "yes" : "") },
  ]);
  return csvResponse(csv, `leads-${dateKeyInTz(new Date(), tz)}.csv`);
}
