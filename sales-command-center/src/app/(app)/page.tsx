import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { dashboardData } from "@/server/services/dashboard";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { DueBadge, OutcomeBadge, RescheduleBadge } from "@/components/badges";
import { RangePicker } from "@/components/RangePicker";
import { money } from "@/lib/labels";
import { fmtDate, fmtDateKey, fmtDateTime, fmtTime, resolveRange, apptTime, apptDateTime, visitDateTime } from "@/lib/time";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const range = resolveRange(sp(params, "range") ?? "week", sp(params, "from"), sp(params, "to"), tz);
  const d = await dashboardData(actor, settings, range);
  const now = new Date();
  const isRep = actor.role === "REP";
  const attention = d.pendingReschedules.length + d.overdueFollowUps;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isRep ? `Hi, ${actor.name.split(" ")[0]}` : "Dashboard"}
        subtitle={`${fmtDateKey(d.today, { weekday: "long", month: "long", day: "numeric" })} · figures from recorded data only`}
        actions={<RangePicker range={range} basePath="/" />}
      />

      {isRep && (
        <Link href="/today" className="card flex items-center justify-between border-accent/30 bg-accent-2 px-4 py-3 lg:hidden">
          <span className="font-medium text-accent">Open today’s route →</span>
          <span className="text-sm text-accent">{d.plannedToday} planned · {d.completedToday} done</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active leads" value={d.activeLeads} href="/leads" />
        <Stat label={isRep ? "Assigned to me" : "Assigned to rep"} value={d.assignedLeads} href={isRep ? "/leads" : "/leads?view=mine"} />
        <Stat label="Planned today" value={d.plannedToday} href={isRep ? "/today" : `/schedule?view=timeGridDay&date=${d.today}`} hint={`${d.todayStops.length} visits · ${d.todayAppointments.length} appts`} />
        <Stat label={`Visits completed (${range.label.toLowerCase()})`} value={d.completedVisits} href={`/visits?range=${range.preset}${range.preset === "custom" ? `&from=${range.startKey}&to=${range.endKey}` : ""}`} tone="accent" />
        <Stat label="Follow-ups due" value={d.followUpsDueCount} href="/follow-ups?due=today" tone={d.overdueFollowUps ? "bad" : d.followUpsDueCount ? "warn" : undefined} hint={d.overdueFollowUps ? `${d.overdueFollowUps} overdue` : undefined} />
        <Stat label="Not visited recently" value={d.staleLeads + d.neverVisited} href="/leads?view=stale" hint={`${d.neverVisited} never · ${d.staleLeads} ${settings.staleVisitDays}+ days`} />
        <Stat label="Sales closed this week" value={d.salesWeek.wonCount} href="/sales?status=WON&range=week" hint={money(d.salesWeek.revenue)} tone="good" />
        <Stat label="Sales closed this month" value={d.salesMonth.wonCount} href="/sales?status=WON&range=month" hint={money(d.salesMonth.revenue)} tone="good" />
        <Stat label={`Revenue (${range.label.toLowerCase()})`} value={money(d.salesRange.revenue)} href={`/sales?status=WON&range=${range.preset}${range.preset === "custom" ? `&from=${range.startKey}&to=${range.endKey}` : ""}`} hint="Closed-won only" />
        <Stat label="Total recorded revenue" value={money(d.salesAll.revenue)} href="/sales?status=WON&range=all" hint={`${d.salesAll.wonCount} won deal(s), all time`} />
        <Stat label="Open pipeline" value={money(d.salesAll.pipelineValue)} href="/sales?view=open" hint={`${d.salesAll.openCount} open · estimated`} />
        <Stat label="Needs attention" value={attention} href={isRep ? "/follow-ups?due=overdue" : "/reschedules"} tone={attention ? "warn" : undefined} hint={`${d.pendingReschedules.length} reschedule(s) · ${d.overdueFollowUps} overdue`} />
      </div>
      {d.hasDemo && <p className="text-xs text-amber-800">Includes optional demonstration records (marked “Demo”). Remove them in Settings.</p>}

      <Section title="This week" subtitle="Planned visits vs. completed visits, calls and appointments by day">
        <div className="grid grid-cols-7 divide-x divide-line-2 text-center">
          {d.weekDays.map((w) => (
            <Link key={w.date} href={`/schedule?date=${w.date}`} className={`px-1 py-3 hover:bg-canvas ${w.date === d.today ? "bg-accent-2/60" : ""}`}>
              <div className="text-xs text-muted">{fmtDateKey(w.date, { weekday: "short" })}</div>
              <div className="text-[11px] text-muted">{fmtDateKey(w.date, { month: "numeric", day: "numeric" })}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{w.visited}<span className="text-xs font-normal text-muted">/{w.planned}</span></div>
              <div className="text-[11px] text-muted">visited/planned</div>
              <div className="mt-1 text-[11px] text-ink-2">{w.appointments} appt · {w.calls} call</div>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Today’s planned visits" action={<Link className="link text-xs" href={isRep ? "/today" : "/schedule"}>{isRep ? "Open route" : "Schedule"}</Link>}>
          {d.todayStops.length === 0 && d.todayAppointments.length === 0 ? <Empty>Nothing planned for today.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.todayAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/leads/${a.lead.id}`} className="font-medium hover:underline">{a.lead.businessName}</Link><div className="text-xs text-muted">{apptTime(a, tz)} appointment{isRep ? "" : ` · ${a.rep.name}`}</div></div>
                  <Badge tone="accent">Appointment</Badge>
                </li>
              ))}
              {d.todayStops.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/leads/${s.lead.id}`} className="font-medium hover:underline">{s.lead.businessName}</Link><div className="truncate text-xs text-muted">{[s.lead.address, s.dayPlan.area?.name].filter(Boolean).join(" · ")}{isRep ? "" : ` · ${s.dayPlan.rep.name}`}</div></div>
                  <Badge tone={s.status === "VISITED" ? "good" : s.status === "SKIPPED" ? "muted" : "info"}>{s.status === "VISITED" ? "Visited" : s.status === "SKIPPED" ? "Skipped" : "Planned"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Upcoming appointments" subtitle="Next 14 days" action={<Link className="link text-xs" href="/appointments">All</Link>}>
          {d.upcoming.length === 0 ? <Empty>No upcoming appointments.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/appointments/${a.id}`} className="font-medium hover:underline">{a.lead.businessName}</Link><div className="text-xs text-muted">{apptDateTime(a, tz)}{isRep ? "" : ` · ${a.rep.name}`}</div></div>
                  <Badge tone={a.status === "CONFIRMED" ? "accent" : "info"}>{a.status === "CONFIRMED" ? "Confirmed" : "Scheduled"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Needs attention" subtitle="Pending reschedule requests and follow-ups due" action={<Link className="link text-xs" href="/reschedules">Reschedules</Link>}>
          {d.pendingReschedules.length === 0 && d.followUpsDue.length === 0 ? <Empty>All clear.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.pendingReschedules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/reschedules#${r.id}`} className="font-medium hover:underline">{r.lead.businessName}</Link><div className="text-xs text-muted">{fmtDateTime(r.originalStart, tz)} → {fmtDateTime(r.requestedStart, tz)} · {r.requestedBy.name}: {r.reason}</div></div>
                  <RescheduleBadge s="PENDING" />
                </li>
              ))}
              {d.followUpsDue.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/leads/${f.lead.id}`} className="font-medium hover:underline">{f.lead.businessName}</Link><div className="truncate text-xs text-muted">{f.action} · {fmtDate(f.dueAt, tz)}{isRep ? "" : ` · ${f.assignedTo.name}`}</div></div>
                  <DueBadge due={f.dueAt} now={now} tz={tz} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Rescheduled or canceled" subtitle="Last 14 days" action={<Link className="link text-xs" href="/appointments?status=changed">All changes</Link>}>
          {d.changedAppts.length === 0 ? <Empty>No recent changes.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.changedAppts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/appointments/${c.appointmentId}`} className="font-medium hover:underline">{c.appointment.lead.businessName}</Link><div className="truncate text-xs text-muted">{c.action === "MOVED" ? `${fmtDateTime(c.fromStart, tz)} → ${fmtDateTime(c.toStart, tz)}` : `Was ${fmtDateTime(c.fromStart, tz)}`}{c.reason ? ` · ${c.reason}` : ""}</div></div>
                  <Badge tone={c.action === "MOVED" ? "warn" : "muted"}>{c.action === "MOVED" ? "Rescheduled" : "Canceled"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent rep feedback" action={<Link className="link text-xs" href="/visits">All visits</Link>}>
          {d.recentFeedback.length === 0 ? <Empty>No feedback yet.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.recentFeedback.map((v) => (
                <li key={v.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${v.lead.id}?tab=visits`} className="font-medium hover:underline">{v.lead.businessName}</Link><OutcomeBadge o={v.outcome} /></div>
                  <p className="line-clamp-2 text-sm text-ink-2">{v.feedback ?? v.objections}</p>
                  <div className="text-xs text-muted">{visitDateTime(v, tz)} · {v.rep.name}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent sales" action={<Link className="link text-xs" href="/sales?status=WON">Sales</Link>}>
          {d.recentSales.length === 0 ? <Empty>No closed sales recorded yet.</Empty> : (
            <ul className="divide-y divide-line-2">
              {d.recentSales.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0"><Link href={`/sales/${o.id}`} className="font-medium hover:underline">{o.lead.businessName}</Link><div className="text-xs text-muted">{o.product} · {fmtDate(o.closedAt, tz)}{isRep ? "" : ` · ${o.rep.name}`}</div></div>
                  <span className="font-semibold tabular-nums text-emerald-700">{money(o.finalAmount ? Number(o.finalAmount) : null)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
