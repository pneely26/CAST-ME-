import { can } from "@/server/policy";
import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { reportData } from "@/server/services/reports";
import { prisma } from "@/server/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { resolveRange } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Report summary as rows of section / metric / value — same numbers and definitions as the Reports page. */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "data.export")) return Response.json({ error: "Only the coordinator can export data." }, { status: 403 });
  const settings = await getSettings();
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const range = resolveRange(params.range ?? "month", params.from, params.to, settings.timezone);
  const d = await reportData(actor, params, range, { tz: settings.timezone, staleDays: settings.staleVisitDays });
  const s = d.sales.summary;
  const r2 = (n: number | null) => (n === null ? "" : n.toFixed(2));
  const rate = (n: number | null) => (n === null ? "" : (n * 100).toFixed(1) + "%");
  const rows: [string, string, string | number][] = [
    ["Range", "Period", range.label],
    ["Range", "From", range.preset === "all" ? "" : range.startKey],
    ["Range", "To", range.preset === "all" ? "" : range.endKey],
    ["Sales", "Closed sales (won)", s.wonCount],
    ["Sales", "Realized revenue (closed won only)", r2(s.revenue)],
    ["Sales", "Average deal", r2(s.averageDeal)],
    ["Sales", "Deals lost", s.lostCount],
    ["Sales", "Win rate", rate(s.winRate)],
    ["Sales", "Opportunities created", d.sales.oppsCreated],
    ["Sales", "Lead-to-sale conversion", rate(d.sales.conversion)],
    ["Sales", "Commission recorded (won)", r2(s.commission)],
    ["Pipeline (not revenue)", "Open opportunities", s.openCount],
    ["Pipeline (not revenue)", "Estimated open pipeline value", r2(s.pipelineValue)],
    ...d.sales.revenueSeries.map((x) => ["Revenue by " + d.sales.bucket, x.key, `${r2(x.total)} (${x.count} deal(s))`] as [string, string, string]),
    ...d.sales.byProduct.map((x) => ["Revenue by product", x.key, `${r2(x.total)} (${x.count} deal(s))`] as [string, string, string]),
    ["Leads", "New leads", d.leads.newCount],
    ["Leads", "Overdue follow-ups (now)", d.leads.overdueFollowUps],
    ["Leads", `Not visited in ${settings.staleVisitDays}+ days or never`, d.leads.neverOrStale],
    ...d.leads.byArea.map((x) => ["New leads by area", x.key, x.count] as [string, string, number]),
    ...d.leads.byStatus.map((x) => ["Leads by status (current)", x.key, x.count] as [string, string, number]),
    ["Visits", "In-person visits", d.visits.inPerson],
    ["Visits", "Phone calls", d.visits.phoneCalls],
    ["Visits", "Planned stops", d.visits.planned.total],
    ["Visits", "Planned stops visited", d.visits.planned.visited],
    ["Visits", "Planned stops skipped", d.visits.planned.skipped],
    ...d.visits.series.map((x) => ["Visits by " + d.visits.bucket, x.key, x.count] as [string, string, number]),
    ...d.visits.outcomes.map((x) => ["Visit outcomes", x.key, x.count] as [string, string, number]),
    ["Follow-ups", "Due in range", d.followUps.due],
    ["Follow-ups", "Done", d.followUps.done],
    ["Follow-ups", "Still open", d.followUps.open],
    ["Follow-ups", "Completion rate", rate(d.followUps.completionRate)],
    ["Appointments", "Booked (starting in range)", d.appointments.booked],
    ["Appointments", "Kept (completed)", d.appointments.kept],
    ["Appointments", "No-show", d.appointments.noShow],
    ["Appointments", "Canceled", d.appointments.canceled],
    ["Appointments", "Kept rate", rate(d.appointments.keptRate)],
    ["Appointments", "Moves (reschedules)", d.appointments.moves],
    ...d.repActivity.flatMap((x) => [
      ["Rep activity: " + x.name, "Visits", x.visits],
      ["Rep activity: " + x.name, "Calls", x.calls],
      ["Rep activity: " + x.name, "Appointments kept", x.apptsKept],
      ["Rep activity: " + x.name, "Follow-ups done", x.followUpsDone],
      ["Rep activity: " + x.name, "Deals won", x.won],
      ["Rep activity: " + x.name, "Revenue", r2(x.revenue)],
    ] as [string, string, string | number][]),
  ];
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.report", entityType: "Report", summary: `Exported report summary to CSV (${range.label})` } });
  return csvResponse(toCsv(rows, [{ header: "Section", value: (r) => r[0] }, { header: "Metric", value: (r) => r[1] }, { header: "Value", value: (r) => r[2] }]), `report-${range.preset === "all" ? "all-time" : `${range.startKey}-to-${range.endKey}`}.csv`);
}
