import { getActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getSchedule } from "@/server/services/schedule";
import { ACTIVE_APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABEL } from "@/lib/labels";
import { addDays, dateKeyInTz, daysBetween, isDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = { SCHEDULED: "#2563eb", CONFIRMED: "#3451b2", COMPLETED: "#059669", CANCELED: "#9ca3af", NO_SHOW: "#dc2626" };

/** FullCalendar event feed: territory plans (all-day), appointments, follow-ups. Scoped to the user. */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const tz = (await getSettings()).timezone;
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() - start.getTime() > 100 * 86_400_000) return Response.json({ error: "Bad range" }, { status: 400 });
  const repParam = url.searchParams.get("rep");
  const repId = actor.role === "REP" ? actor.id : repParam && repParam !== "all" ? repParam : null;
  const showCanceled = url.searchParams.get("canceled") === "1";

  const [appts, followUps, reps] = await Promise.all([
    prisma.appointment.findMany({
      where: { startAt: { lt: end }, endAt: { gt: start }, ...(repId ? { repId } : {}), ...(showCanceled ? {} : { status: { not: "CANCELED" } }) },
      include: { lead: { select: { id: true, businessName: true } }, rep: { select: { name: true } }, changes: { where: { action: "MOVED" }, select: { id: true } }, reschedules: { where: { status: "PENDING" }, select: { id: true } } },
    }),
    prisma.followUp.findMany({ where: { status: "OPEN", dueAt: { gte: start, lt: end }, lead: { archivedAt: null }, ...(repId ? { assignedToId: repId } : {}) }, include: { lead: { select: { id: true, businessName: true } } } }),
    repId ? prisma.user.findMany({ where: { id: repId } }) : prisma.user.findMany({ where: { role: "REP", active: true } }),
  ]);

  const events: Record<string, unknown>[] = [];
  const startKey = dateKeyInTz(start, tz);
  const days = Math.min(62, Math.max(1, daysBetween(startKey, dateKeyInTz(end, tz))));
  for (const rep of reps) {
    const sched = await getSchedule(actor.role === "REP" ? actor : { ...actor }, rep.id, startKey, days);
    for (const d of sched) {
      if (d.source === "none" && d.stops.length === 0) continue;
      const planned = d.stops.length;
      const done = d.stops.filter((s) => s.status === "VISITED").length;
      const where = d.areaName ?? d.label ?? d.territoryName ?? "Plan";
      events.push({
        id: `plan:${rep.id}:${d.date}`,
        title: `${reps.length > 1 ? `${rep.name.split(" ")[0]}: ` : ""}📍 ${where}${d.label && d.areaName ? ` · ${d.label}` : ""}${planned ? ` · ${done}/${planned} visits` : ""}${d.visitTarget ? ` · target ${d.visitTarget}` : ""}${d.isOverride ? " · changed" : ""}`,
        start: d.date,
        end: addDays(d.date, 1),
        allDay: true,
        editable: false,
        backgroundColor: d.territoryColor ?? "#6b7280",
        borderColor: d.territoryColor ?? "#6b7280",
        classNames: ["is-plan"],
        extendedProps: { type: "plan", date: d.date, repId: rep.id },
      });
    }
  }
  for (const a of appts) {
    const active = ACTIVE_APPOINTMENT_STATUSES.includes(a.status);
    const moved = a.changes.length > 0;
    events.push({
      id: `appt:${a.id}`,
      title: `${a.kind === "FOLLOW_UP_VISIT" ? "↻ " : ""}${a.lead.businessName}${!repId ? ` (${a.rep.name.split(" ")[0]})` : ""}${a.status !== "SCHEDULED" ? ` · ${APPOINTMENT_STATUS_LABEL[a.status]}` : ""}${moved ? " · rescheduled" : ""}${a.reschedules.length ? " · change requested" : ""}`,
      ...(a.timeSet ? { start: a.startAt.toISOString(), end: a.endAt.toISOString() } : { start: dateKeyInTz(a.startAt, tz), end: addDays(dateKeyInTz(a.startAt, tz), 1), allDay: true }),
      editable: active,
      backgroundColor: STATUS_COLOR[a.status],
      borderColor: STATUS_COLOR[a.status],
      classNames: [a.status === "CANCELED" ? "is-canceled" : "", a.kind === "FOLLOW_UP_VISIT" ? "is-followup" : ""].filter(Boolean),
      extendedProps: { type: "appointment", id: a.id, leadId: a.lead.id, status: a.status, timeSet: a.timeSet },
    });
  }
  for (const f of followUps) {
    events.push({
      id: `fu:${f.id}`,
      title: `↻ Follow-up: ${f.lead.businessName}`,
      start: f.dueAt.toISOString(),
      end: new Date(f.dueAt.getTime() + 15 * 60_000).toISOString(),
      editable: false,
      backgroundColor: "#fff7ed",
      borderColor: "#d97706",
      textColor: "#92400e",
      classNames: ["is-followup"],
      extendedProps: { type: "followup", leadId: f.lead.id },
    });
  }
  return Response.json(events, { headers: { "Cache-Control": "private, no-store" } });
}

