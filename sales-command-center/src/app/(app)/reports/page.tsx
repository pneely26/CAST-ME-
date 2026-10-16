import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { reportData } from "@/server/services/reports";
import { sp, type SP } from "@/server/services/leadQuery";
import { repOptions } from "@/server/options";
import { Empty, PageHeader, Section, Stat } from "@/components/ui";
import { RangePicker } from "@/components/RangePicker";
import { money, pct } from "@/lib/labels";
import { fmtDateKey, resolveRange } from "@/lib/time";

export const metadata = { title: "Reports" };

function Bars({ rows, value, label, fmt = (n: number) => String(n) }: { rows: { key: string }[]; value: (r: never) => number; label: (r: never) => string; fmt?: (n: number) => string }) {
  const vals = rows.map((r) => value(r as never));
  const max = Math.max(1, ...vals);
  if (!rows.length) return <Empty>No records in this range.</Empty>;
  return (
    <ul className="space-y-1.5 px-4 py-3 text-sm">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(90px,160px)_1fr_auto] items-center gap-2">
          <span className="truncate text-ink-2">{label(r as never)}</span>
          <span className="h-2.5 rounded bg-canvas" aria-hidden><span className="block h-full rounded bg-accent" style={{ width: `${(vals[i] / max) * 100}%` }} /></span>
          <span className="tabular-nums">{fmt(vals[i])}</span>
        </li>
      ))}
    </ul>
  );
}

const periodLabel = (key: string, b: "day" | "week" | "month") =>
  b === "month" ? fmtDateKey(key, { month: "short", year: "numeric" }) : b === "week" ? `Week of ${fmtDateKey(key, { month: "short", day: "numeric" })}` : fmtDateKey(key, { weekday: "short", month: "short", day: "numeric" });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const settings = await getSettings();
  const tz = settings.timezone;
  const range = resolveRange(sp(params, "range") ?? "month", sp(params, "from"), sp(params, "to"), tz);
  const isCoord = actor.role === "COORDINATOR";
  const [d, reps] = await Promise.all([reportData(actor, params, range, { tz, staleDays: settings.staleVisitDays }), isCoord ? repOptions() : Promise.resolve([])]);
  const rep = isCoord ? sp(params, "rep") : undefined;
  const extra: Record<string, string> = rep ? { rep } : {};
  const qs = new URLSearchParams({ ...extra, range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) }).toString();
  const s = d.sales.summary;
  const reqs = d.appointments.requests;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        subtitle={`${range.label}${rep ? ` · ${reps.find((r) => r.id === rep)?.name ?? "rep"}` : isCoord ? " · all reps" : ""}. Every figure is counted from saved records.`}
        actions={isCoord ? <a className="btn-secondary" href={`/api/export/reports?${qs}`}>Export CSV</a> : undefined}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangePicker range={range} basePath="/reports" extra={extra} allowAll />
        {isCoord && reps.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-sm">
            <Link href={`/reports?${new URLSearchParams({ range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) })}`} className={!rep ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>All reps</Link>
            {reps.map((r) => <Link key={r.id} href={`/reports?${new URLSearchParams({ rep: r.id, range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) })}`} className={rep === r.id ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{r.name}</Link>)}
          </div>
        )}
      </div>
      {d.hasDemo && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Demonstration records exist in the database and are included below. Remove them in Settings to see real figures only.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Closed sales" value={s.wonCount} hint="Closed won in range" tone="good" />
        <Stat label="Realized revenue" value={money(s.revenue)} hint="Closed-won final amounts only" tone="good" />
        <Stat label="Win rate" value={pct(s.winRate)} hint={`${s.wonCount} won · ${s.lostCount} lost`} />
        <Stat label="Lead → sale conversion" value={pct(d.sales.conversion)} hint="Won leads ÷ new leads" />
        <Stat label="Open pipeline" value={money(s.pipelineValue)} hint={`${s.openCount} open · estimated, not revenue`} />
        <Stat label="Opportunities created" value={d.sales.oppsCreated} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Revenue by period" subtitle="Closed-won deals by close date">
          <Bars rows={d.sales.revenueSeries} value={(r: { total: number }) => r.total} label={(r: { key: string; count: number }) => `${periodLabel(r.key, d.sales.bucket)} (${r.count})`} fmt={(n) => money(n)} />
        </Section>
        <Section title="Revenue by product / service">
          <Bars rows={d.sales.byProduct} value={(r: { total: number }) => r.total} label={(r: { key: string; count: number }) => `${r.key} (${r.count})`} fmt={(n) => money(n)} />
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="In-person visits" value={d.visits.inPerson} hint={`${d.visits.phoneCalls} phone call(s) separate`} />
        <Stat label="Planned stops visited" value={`${d.visits.planned.visited} / ${d.visits.planned.total}`} hint={`${d.visits.planned.skipped} skipped · ${d.visits.planned.pending} not done`} />
        <Stat label="Follow-ups completed" value={pct(d.followUps.completionRate)} hint={`${d.followUps.done} done · ${d.followUps.open} open of ${d.followUps.due} due`} />
        <Stat label="Overdue follow-ups" value={d.leads.overdueFollowUps} hint="Open and past due (now)" tone={d.leads.overdueFollowUps ? "bad" : undefined} />
        <Stat label="Appointments kept" value={`${d.appointments.kept} / ${d.appointments.booked}`} hint={`Kept rate ${pct(d.appointments.keptRate)} · ${d.appointments.noShow} no-show · ${d.appointments.canceled} canceled`} />
        <Stat label="Reschedules" value={d.appointments.moves} hint={`Requests: ${reqs.PENDING ?? 0} pending · ${reqs.APPROVED ?? 0} approved · ${reqs.DECLINED ?? 0} declined`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`In-person visits by ${d.visits.bucket}`}>
          <Bars rows={d.visits.series} value={(r: { count: number }) => r.count} label={(r: { key: string }) => periodLabel(r.key, d.visits.bucket)} />
        </Section>
        <Section title="Visit outcomes" subtitle="All visits and calls in range">
          <Bars rows={d.visits.outcomes} value={(r: { count: number }) => r.count} label={(r: { key: string }) => r.key} />
        </Section>
        <Section title="New leads by area" subtitle={`${d.leads.newCount} lead(s) added in range`}>
          <Bars rows={d.leads.byArea} value={(r: { count: number }) => r.count} label={(r: { key: string }) => r.key} />
        </Section>
        <Section title="Leads by status" subtitle={`Current snapshot of all active leads · ${d.leads.neverOrStale} open lead(s) not visited in ${settings.staleVisitDays}+ days or never`}>
          <Bars rows={d.leads.byStatus} value={(r: { count: number }) => r.count} label={(r: { key: string }) => r.key} />
        </Section>
      </div>

      <Section title="Rep activity" subtitle={range.label}>
        {d.repActivity.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Rep</th><th className="text-right">Visits</th><th className="text-right">Calls</th><th className="text-right">Appointments kept</th><th className="text-right">Follow-ups done</th><th className="text-right">Deals won</th><th className="text-right">Revenue</th></tr></thead>
              <tbody>
                {d.repActivity.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}{!r.active && <span className="ml-1 text-xs text-muted">(inactive)</span>}</td>
                    <td className="text-right tabular-nums">{r.visits}</td>
                    <td className="text-right tabular-nums">{r.calls}</td>
                    <td className="text-right tabular-nums">{r.apptsKept}</td>
                    <td className="text-right tabular-nums">{r.followUpsDone}</td>
                    <td className="text-right tabular-nums">{r.won}</td>
                    <td className="text-right font-medium tabular-nums">{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No reps yet.</Empty>}
      </Section>

      <details className="card px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">How these numbers are counted</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
          <li><b>Closed sales / revenue:</b> opportunities closed won with a close date in the range. Revenue is their final amount. Each deal is counted once; archived deals are excluded.</li>
          <li><b>Open pipeline:</b> estimated value of opportunities still open today. It is never added to revenue.</li>
          <li><b>Win rate:</b> won ÷ (won + lost), both closed in the range.</li>
          <li><b>Conversion:</b> distinct leads with a won sale in the range ÷ leads created in the range.</li>
          <li><b>Visits:</b> in-person visits dated in the range. Phone calls count as contact, not visits.</li>
          <li><b>Planned stops:</b> stops on day plans dated in the range and whether they were visited.</li>
          <li><b>Follow-ups:</b> follow-ups due in the range; completion = done ÷ (done + still open).</li>
          <li><b>Appointments:</b> appointments starting in the range. Kept rate = completed ÷ (completed + no-show).</li>
          <li><b>Reschedules:</b> appointment moves recorded in the range (each move once), plus reschedule requests made in the range.</li>
        </ul>
      </details>
    </div>
  );
}
