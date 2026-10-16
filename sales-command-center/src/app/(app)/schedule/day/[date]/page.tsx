import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getSchedule } from "@/server/services/schedule";
import { repOptions } from "@/server/options";
import { territoryOptions } from "@/server/services/territories";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { LeadStatusBadge, PriorityBadge, ApptStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { addStopsAction, resetDayAction, saveDayAction, stopAction, dayStatusAction } from "@/app/actions/schedule";
import { ACTIVE_APPOINTMENT_STATUSES, DAY_PLAN_STATUS_LABEL } from "@/lib/labels";
import { addDays, dateKeyInTz, dayRangeUtc, fmtDate, fmtDateKey, fmtTime, isDateKey } from "@/lib/time";

export const metadata = { title: "Day plan" };

export default async function DayPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<SP> }) {
  const { date } = await params;
  if (!isDateKey(date)) notFound();
  const q = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const reps = actor.role === "COORDINATOR" ? await repOptions() : [{ id: actor.id, name: actor.name }];
  const repId = actor.role === "REP" ? actor.id : (sp(q, "rep") ?? reps[0]?.id);
  if (!repId) notFound();
  const rep = reps.find((r) => r.id === repId);
  const [day] = await getSchedule(actor, repId, date, 1);
  const territories = await territoryOptions();
  const pickArea = sp(q, "pick") ?? day.areaId ?? "";
  const { start, end } = dayRangeUtc(date, date, tz);
  const onPlan = new Set(day.stops.map((s) => s.lead.id));
  const [appointments, candidates] = await Promise.all([
    prisma.appointment.findMany({ where: { repId, startAt: { gte: start, lt: end } }, include: { lead: { select: { id: true, businessName: true } } }, orderBy: { startAt: "asc" } }),
    prisma.lead.findMany({
      where: { archivedAt: null, assignedRepId: repId, status: { notIn: ["DO_NOT_CONTACT", "NOT_A_FIT", "LOST"] }, ...(pickArea && pickArea !== "all" ? { areaId: pickArea } : {}) },
      orderBy: [{ priority: "desc" }, { lastVisitAt: { sort: "asc", nulls: "first" } }],
      take: 60,
      select: { id: true, businessName: true, address: true, status: true, priority: true, lastVisitAt: true, nextFollowUpAt: true, area: { select: { name: true } } },
    }),
  ]);
  const rq = actor.role === "COORDINATOR" ? `rep=${repId}` : "";
  const today = dateKeyInTz(new Date(), tz);

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: `/schedule?date=${date}${rq ? `&${rq}` : ""}`, label: "Schedule" }}
        title={fmtDateKey(date, { weekday: "long", month: "long", day: "numeric" })}
        subtitle={<span className="flex flex-wrap items-center gap-2">{rep?.name}{day.isOverride && <Badge tone="warn">One-off change</Badge>}{day.source === "template" && <Badge tone="muted">From recurring plan</Badge>}<Badge tone="info">{DAY_PLAN_STATUS_LABEL[day.status as keyof typeof DAY_PLAN_STATUS_LABEL]}</Badge></span>}
        actions={
          <>
            <Link className="btn-secondary" href={`/schedule/day/${addDays(date, -1)}${rq ? `?${rq}` : ""}`}>← Prev day</Link>
            <Link className="btn-secondary" href={`/schedule/day/${addDays(date, 1)}${rq ? `?${rq}` : ""}`}>Next day →</Link>
            {date === today && actor.role === "REP" && <Link className="btn-primary" href="/today">Open route</Link>}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Plan for this day" className="lg:col-span-1">
          <ActionForm action={saveDayAction} className="grid gap-3 p-4">
            <input type="hidden" name="repId" value={repId} />
            <input type="hidden" name="date" value={date} />
            <label className="block"><span className="label">Area</span>
              <select name="areaId" defaultValue={day.areaId ?? ""} className="input">
                <option value="">No specific area</option>
                {territories.map((t) => <optgroup key={t.id} label={t.name}>{t.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="block"><span className="label">Territory (if no area)</span>
              <select name="territoryId" defaultValue={day.territoryId ?? ""} className="input"><option value="">—</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="block"><span className="label">Label</span><input name="label" defaultValue={day.label ?? ""} className="input" placeholder="e.g. Follow-ups & appointments" /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block"><span className="label">Start</span><input type="time" name="startTime" defaultValue={day.startTime ?? ""} className="input" /></label>
              <label className="block"><span className="label">End</span><input type="time" name="endTime" defaultValue={day.endTime ?? ""} className="input" /></label>
              <label className="block"><span className="label">Target</span><input type="number" min={0} max={200} name="visitTarget" defaultValue={day.visitTarget ?? ""} className="input" /></label>
            </div>
            <label className="block"><span className="label">Route notes</span><textarea name="notes" rows={3} defaultValue={day.notes ?? ""} className="input" /></label>
            <SubmitButton>Save day</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            {(["PLANNED", "IN_PROGRESS", "COMPLETED", "CHANGED"] as const).filter((s) => s !== day.status).map((s) => (
              <ActionForm key={s} action={dayStatusAction}><input type="hidden" name="repId" value={repId} /><input type="hidden" name="date" value={date} /><input type="hidden" name="status" value={s} /><SubmitButton className="btn-ghost btn-sm">Mark {DAY_PLAN_STATUS_LABEL[s].toLowerCase()}</SubmitButton></ActionForm>
            ))}
            {day.isOverride && (
              <ActionForm action={resetDayAction}><input type="hidden" name="repId" value={repId} /><input type="hidden" name="date" value={date} /><SubmitButton className="btn-ghost btn-sm" confirm="Reset this day to the recurring plan? Planned leads stay on the day.">Reset to recurring plan</SubmitButton></ActionForm>
            )}
          </div>
        </Section>

        <div className="space-y-5 lg:col-span-2">
          <Section title={`Planned visits (${day.stops.length})`} subtitle={day.visitTarget ? `Target ${day.visitTarget}` : undefined}>
            {day.stops.length === 0 ? <Empty>No businesses planned yet — add some below.</Empty> : (
              <ol className="divide-y divide-line-2">
                {day.stops.map((s, i) => (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 w-5 text-right text-xs tabular-nums text-muted">{i + 1}.</span>
                      <div className="min-w-0">
                        <Link className="font-medium hover:underline" href={`/leads/${s.lead.id}`}>{s.lead.businessName}</Link>
                        <div className="truncate text-xs text-muted">{s.lead.address ?? "No address"} · {s.lead.lastVisitAt ? `last visited ${fmtDate(s.lead.lastVisitAt, tz)}` : "never visited"}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={s.status === "VISITED" ? "good" : s.status === "SKIPPED" ? "muted" : "info"}>{s.status === "VISITED" ? "Visited" : s.status === "SKIPPED" ? "Skipped" : "Planned"}</Badge>
                      {s.status === "PLANNED" && <Link href={`/leads/${s.lead.id}/visit?returnTo=${encodeURIComponent(`/schedule/day/${date}${rq ? `?${rq}` : ""}`)}`} className="btn-primary btn-sm">Record visit</Link>}
                      {["up", "down"].map((op) => (
                        <ActionForm key={op} action={stopAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value={op} /><SubmitButton className="btn-ghost btn-sm">{op === "up" ? "↑" : "↓"}</SubmitButton></ActionForm>
                      ))}
                      {s.status === "PLANNED" && <ActionForm action={stopAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="skip" /><SubmitButton className="btn-ghost btn-sm">Skip</SubmitButton></ActionForm>}
                      {s.status === "SKIPPED" && <ActionForm action={stopAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="plan" /><SubmitButton className="btn-ghost btn-sm">Un-skip</SubmitButton></ActionForm>}
                      {s.status !== "VISITED" && <ActionForm action={stopAction} confirm="Remove this business from the day's plan?"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="remove" /><SubmitButton className="btn-ghost btn-sm">Remove</SubmitButton></ActionForm>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Appointments this day" action={<Link href={`/appointments/new?date=${date}${rq ? `&${rq}` : ""}`} className="link text-xs">Book</Link>}>
            {appointments.length === 0 ? <Empty>None.</Empty> : (
              <ul className="divide-y divide-line-2">
                {appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div><Link className="font-medium hover:underline" href={`/appointments/${a.id}`}>{fmtTime(a.startAt, tz)} · {a.lead.businessName}</Link></div>
                    <ApptStatusBadge s={a.status} />
                  </li>
                ))}
              </ul>
            )}
            {appointments.some((a) => ACTIVE_APPOINTMENT_STATUSES.includes(a.status)) ? null : null}
          </Section>

          <Section
            title="Add businesses to this day"
            subtitle={`Leads assigned to ${rep?.name ?? "the rep"}, highest priority and longest since last visit first`}
            action={
              <form method="get" className="flex items-center gap-1">
                {rq && <input type="hidden" name="rep" value={repId} />}
                <select name="pick" defaultValue={pickArea || "all"} className="input py-1 text-xs" aria-label="Show leads from area">
                  <option value="all">All areas</option>
                  {territories.map((t) => <optgroup key={t.id} label={t.name}>{t.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
                </select>
                <button className="btn-secondary btn-sm">Show</button>
              </form>
            }
          >
            {candidates.filter((c) => !onPlan.has(c.id)).length === 0 ? <Empty>No more leads to add{pickArea && pickArea !== "all" ? " in this area" : ""}.</Empty> : (
              <ActionForm action={addStopsAction} resetOnSuccess>
                <input type="hidden" name="repId" value={repId} />
                <input type="hidden" name="date" value={date} />
                <ul className="max-h-[420px] divide-y divide-line-2 overflow-y-auto">
                  {candidates.filter((c) => !onPlan.has(c.id)).map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-canvas">
                        <input type="checkbox" name="leadIds" value={c.id} className="h-4 w-4" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{c.businessName}</span> <PriorityBadge p={c.priority} quietNormal />
                          <span className="block truncate text-xs text-muted">{[c.area?.name, c.address].filter(Boolean).join(" · ")} · {c.lastVisitAt ? `last visited ${fmtDate(c.lastVisitAt, tz)}` : "never visited"}{c.nextFollowUpAt ? ` · follow-up ${fmtDate(c.nextFollowUpAt, tz)}` : ""}</span>
                        </span>
                        <LeadStatusBadge s={c.status} />
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-line p-3"><SubmitButton>Add selected to {fmtDateKey(date, { weekday: "long" })}</SubmitButton></div>
              </ActionForm>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
