import { can } from "@/server/policy";
import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { listAppointments } from "@/server/services/appointmentQuery";
import { prisma } from "@/server/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/labels";
import { dateKeyInTz, fmtDateTime, apptDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Schedule export: appointments with status and reschedule count. */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(actor, "data.export")) return Response.json({ error: "Only the coordinator can export data." }, { status: 403 });
  const tz = (await getSettings()).timezone;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await listAppointments(actor, params, 20000);
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "export.appointments", entityType: "Appointment", summary: `Exported ${rows.length} appointment(s) to CSV` } });
  return csvResponse(
    toCsv(rows, [
      { header: "Start", value: (a) => apptDateTime(a, tz) },
      { header: "End", value: (a) => fmtDateTime(a.endAt, tz) },
      { header: "Business", value: (a) => a.lead.businessName },
      { header: "Area", value: (a) => a.lead.area?.name },
      { header: "Address", value: (a) => a.location ?? a.lead.address },
      { header: "Rep", value: (a) => a.rep.name },
      { header: "Type", value: (a) => (a.kind === "FOLLOW_UP_VISIT" ? "Follow-up visit" : "Appointment") },
      { header: "Status", value: (a) => APPOINTMENT_STATUS_LABEL[a.status] },
      { header: "Times rescheduled", value: (a) => a.changes.length },
      { header: "Cancel reason", value: (a) => a.cancelReason },
      { header: "Notes", value: (a) => a.notes },
    ]),
    `appointments-${dateKeyInTz(new Date(), tz)}.csv`,
  );
}
