import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { getSchedule } from "@/server/services/schedule";
import { repOptions } from "@/server/options";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { Calendar } from "@/components/Calendar";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { copyWeekAction, weekToTemplateAction } from "@/app/actions/schedule";
import { DAY_PLAN_STATUS_LABEL } from "@/lib/labels";
import { addDays, dateKeyInTz, fmtClock, fmtDateKey, isDateKey, weekStartKey } from "@/lib/time";
import { WriteOnly } from "@/components/ReadOnly";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = dateKeyInTz(new Date(), tz);
  const date = isDateKey(sp(params, "date")) ? sp(params, "date")! : today;
  const weekStart = weekStartKey(date);
  const reps = actor.role === "COORDINATOR" ? await repOptions() : [{ id: actor.id, name: actor.name }];
  const repId = actor.role === "REP" ? actor.id : (sp(params, "rep") ?? reps[0]?.id ?? null);
  const week = repId ? await getSchedule(actor, repId, weekStart, 7) : [];
  const rq = actor.role === "COORDINATOR" && repId ? `&rep=${repId}` : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Schedule"
        subtitle={`Week of ${fmtDateKey(weekStart, { month: "long", day: "numeric" })} · times in ${tz.replace("_", " ")}`}
        actions={
          <>
            <Link href={`/schedule?date=${addDays(weekStart, -7)}${rq}`} className="btn-secondary">← Prev week</Link>
            <Link href={`/schedule?date=${today}${rq}`} className="btn-secondary">This week</Link>
            <Link href={`/schedule?date=${addDays(weekStart, 7)}${rq}`} className="btn-secondary">Next week →</Link>
            {actor.role === "COORDINATOR" && <Link href="/schedule/email" className="btn-secondary">Email schedules</Link>}
            <WriteOnly><Link href={`/schedule/template${actor.role === "COORDINATOR" && repId ? `?rep=${repId}` : ""}`} className="btn-secondary">Recurring plan</Link></WriteOnly>
            <WriteOnly><Link href={`/appointments/new${repId && actor.role === "COORDINATOR" ? `?rep=${repId}` : ""}`} className="btn-primary">New appointment</Link></WriteOnly>
          </>
        }
      />
      {actor.role === "COORDINATOR" && reps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {reps.map((r) => <Link key={r.id} href={`/schedule?date=${date}&rep=${r.id}`} className={r.id === repId ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{r.name}</Link>)}
        </div>
      )}
      {!repId ? (
        <div className="card"><Empty>Add a sales rep in Settings to start planning.</Empty></div>
      ) : (
        <Section title="Weekly territory plan" subtitle="Where the rep works each day. Edit a day for a one-off change — the recurring plan and future weeks stay the same.">
          <div className="grid divide-y divide-line-2 md:grid-cols-7 md:divide-x md:divide-y-0">
            {week.map((d) => {
              const visited = d.stops.filter((s) => s.status === "VISITED").length;
              return (
                <Link key={d.date} href={`/schedule/day/${d.date}${rq ? `?${rq.slice(1)}` : ""}`} className={`block p-3 hover:bg-canvas ${d.date === today ? "bg-accent-2/50" : ""}`}>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold">{fmtDateKey(d.date, { weekday: "short" })}</span>
                    <span className="text-xs text-muted">{fmtDateKey(d.date, { month: "short", day: "numeric" })}</span>
                  </div>
                  {d.source === "none" && d.stops.length === 0 ? (
                    <div className="mt-2 text-xs text-muted">No plan</div>
                  ) : (
                    <>
                      <div className="mt-1.5 flex items-center gap-1.5 text-sm">
                        <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: d.territoryColor ?? "#9ca3af" }} />
                        <span className="truncate font-medium">{d.areaName ?? d.label ?? d.territoryName ?? "Planned"}</span>
                      </div>
                      {d.label && d.areaName && <div className="truncate text-xs text-ink-2">{d.label}</div>}
                      {(d.startTime || d.endTime) && <div className="text-xs text-muted">{fmtClock(d.startTime)}–{fmtClock(d.endTime)}</div>}
                      <div className="mt-1 text-xs">{visited}/{d.stops.length} visits{d.visitTarget ? ` · target ${d.visitTarget}` : ""}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.isOverride && <Badge tone="warn">Changed</Badge>}
                        {d.status !== "PLANNED" && <Badge tone={d.status === "COMPLETED" ? "good" : "info"}>{DAY_PLAN_STATUS_LABEL[d.status as keyof typeof DAY_PLAN_STATUS_LABEL]}</Badge>}
                        {d.source === "template" && <Badge tone="muted">Recurring</Badge>}
                      </div>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-line p-3">
            <ActionForm action={copyWeekAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="repId" value={repId} />
              <input type="hidden" name="from" value={addDays(weekStart, -7)} />
              <input type="hidden" name="to" value={weekStart} />
              <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="withStops" /> include planned leads</label>
              <SubmitButton className="btn-secondary btn-sm" confirm="Copy last week's day plans into this week? Days in this week will be overwritten with last week's territory and hours.">Copy last week here</SubmitButton>
            </ActionForm>
            <ActionForm action={weekToTemplateAction}>
              <input type="hidden" name="repId" value={repId} />
              <input type="hidden" name="weekStart" value={weekStart} />
              <SubmitButton className="btn-ghost btn-sm" confirm="Use this week's territories and hours as the recurring weekly plan from now on? Individually changed days keep their changes.">Save this week as the recurring plan</SubmitButton>
            </ActionForm>
          </div>
        </Section>
      )}
      <Calendar timeZone={tz} role={actor.role} repId={repId} initialDate={date} initialView={sp(params, "view") ?? "timeGridWeek"} />
    </div>
  );
}
