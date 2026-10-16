import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getSchedule } from "@/server/services/schedule";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { LeadStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { stopAction } from "@/app/actions/schedule";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/labels";
import { dateKeyInTz, dayRangeUtc, fmtClock, fmtDate, fmtDateKey, fmtTime } from "@/lib/time";

export const metadata = { title: "Today's route" };

/** Mobile-first daily route for the rep: tap a business → call / map / record visit → back here. */
export default async function TodayPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  if (actor.role !== "REP") redirect("/schedule");
  const tz = (await getSettings()).timezone;
  const now = new Date();
  const today = dateKeyInTz(now, tz);
  const [day] = await getSchedule(actor, actor.id, today, 1);
  const { start, end } = dayRangeUtc(today, today, tz);
  const [appointments, followUps] = await Promise.all([
    prisma.appointment.findMany({ where: { repId: actor.id, startAt: { gte: start, lt: end }, status: { not: "CANCELED" } }, include: { lead: true }, orderBy: { startAt: "asc" } }),
    prisma.followUp.findMany({ where: { assignedToId: actor.id, status: "OPEN", dueAt: { lt: end }, lead: { archivedAt: null } }, include: { lead: true }, orderBy: { dueAt: "asc" }, take: 20 }),
  ]);
  const done = day.stops.filter((s) => s.status === "VISITED").length;
  const ret = encodeURIComponent("/today");
  const mapLink = (l: { address: string | null; city: string | null }) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.address, l.city].filter(Boolean).join(", "))}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Today’s route" subtitle={`${fmtDateKey(today, { weekday: "long", month: "long", day: "numeric" })} · ${day.areaName ?? day.label ?? "No area planned"}${day.startTime ? ` · ${fmtClock(day.startTime)}–${fmtClock(day.endTime)}` : ""}`} />
      <Flash message={sp(params, "msg")} />
      <div className="card flex items-center justify-between px-4 py-3">
        <div><div className="text-2xl font-semibold tabular-nums">{done}<span className="text-base font-normal text-muted"> / {day.stops.length}{day.visitTarget ? ` (target ${day.visitTarget})` : ""}</span></div><div className="text-xs text-muted">visits done</div></div>
        <Link href={`/schedule/day/${today}`} className="btn-secondary btn-sm">Edit plan</Link>
      </div>
      {day.notes && <p className="rounded-md bg-white px-3 py-2 text-sm ring-1 ring-line">{day.notes}</p>}

      {appointments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Appointments</h2>
          <ul className="space-y-2">
            {appointments.map((a) => (
              <li key={a.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold">{fmtTime(a.startAt, tz)} · {a.lead.businessName}</div><div className="truncate text-sm text-muted">{a.location ?? a.lead.address}</div></div>
                  <Badge tone={a.status === "COMPLETED" ? "good" : a.status === "NO_SHOW" ? "bad" : "accent"}>{a.status === "COMPLETED" ? "Done" : a.status === "NO_SHOW" ? "No-show" : "Appointment"}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {a.lead.phone ? <a className="btn-secondary" href={`tel:${a.lead.phone.replace(/[^\d+]/g, "")}`}>Call</a> : <span />}
                  {a.lead.address ? <a className="btn-secondary" href={mapLink(a.lead)} target="_blank" rel="noopener noreferrer">Map</a> : <span />}
                  {ACTIVE_APPOINTMENT_STATUSES.includes(a.status) ? <Link className="btn-primary" href={`/leads/${a.leadId}/visit?appointment=${a.id}&returnTo=${ret}`}>Visit</Link> : <Link className="btn-ghost" href={`/appointments/${a.id}`}>Details</Link>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Planned visits</h2>
        {day.stops.length === 0 ? <div className="card"><Empty action={<Link href={`/schedule/day/${today}`} className="btn-secondary">Plan today</Link>}>No businesses planned for today.</Empty></div> : (
          <ol className="space-y-2">
            {day.stops.map((s, i) => (
              <li key={s.id} className={`card p-3 ${s.status !== "PLANNED" ? "opacity-70" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/leads/${s.lead.id}`} className="min-w-0">
                    <div className="font-semibold"><span className="text-muted">{i + 1}.</span> {s.lead.businessName}</div>
                    <div className="truncate text-sm text-muted">{s.lead.address ?? "No address"}</div>
                    <div className="mt-1 flex flex-wrap gap-1"><LeadStatusBadge s={s.lead.status} /><span className="text-xs text-muted">{s.lead.lastVisitAt ? `last visit ${fmtDate(s.lead.lastVisitAt, tz)}` : "never visited"}</span></div>
                  </Link>
                  <Badge tone={s.status === "VISITED" ? "good" : s.status === "SKIPPED" ? "muted" : "info"}>{s.status === "VISITED" ? "✓ Visited" : s.status === "SKIPPED" ? "Skipped" : "To visit"}</Badge>
                </div>
                {s.status === "PLANNED" && (
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {s.lead.phone ? <a className="btn-secondary" href={`tel:${s.lead.phone.replace(/[^\d+]/g, "")}`}>Call</a> : <span />}
                    {s.lead.address ? <a className="btn-secondary" href={mapLink(s.lead)} target="_blank" rel="noopener noreferrer">Map</a> : <span />}
                    <ActionForm action={stopAction} confirm="Skip this business today?"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="skip" /><SubmitButton className="btn-ghost w-full">Skip</SubmitButton></ActionForm>
                    <Link className="btn-primary" href={`/leads/${s.lead.id}/visit?returnTo=${ret}`}>Visit</Link>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {followUps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Follow-ups due</h2>
          <ul className="space-y-2">
            {followUps.map((f) => (
              <li key={f.id} className="card flex items-center justify-between gap-2 p-3">
                <Link href={`/leads/${f.leadId}`} className="min-w-0"><div className="font-medium">{f.lead.businessName}</div><div className="truncate text-sm text-muted">{f.action}</div></Link>
                <Badge tone={f.dueAt < start ? "bad" : "warn"}>{f.dueAt < start ? "Overdue" : "Today"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
