import Link from "next/link";
import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { repActivity, repLastSeen } from "@/server/services/activity";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { RangePicker } from "@/components/RangePicker";
import { dateKeyInTz, fmtDate, fmtDateTime, fmtTime, relativeDay, resolveRange } from "@/lib/time";

export const metadata = { title: "Rep activity" };

const KIND_TONE = { login: "good", logout: "muted", failed: "bad", view: "neutral", change: "accent" } as const;
const KIND_LABEL = { login: "Signed in", logout: "Signed out", failed: "Failed sign-in", view: "Viewed", change: "Change" } as const;

function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "audit.view")) return <div className="card"><Empty>Only the coordinator can see rep activity.</Empty></div>;
  const tz = (await getSettings()).timezone;
  const reps = await prisma.user.findMany({ where: { role: "REP" }, select: { id: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  if (!reps.length) return <div className="card"><Empty>No sales reps yet. Add one in Settings → Users.</Empty></div>;
  const repId = sp(params, "rep") && reps.some((r) => r.id === sp(params, "rep")) ? sp(params, "rep")! : reps[0].id;
  const range = resolveRange(sp(params, "range") ?? "week", sp(params, "from"), sp(params, "to"), tz);
  const [lastSeen, data] = await Promise.all([repLastSeen(reps.map((r) => r.id)), repActivity(actor, repId, range)]);
  const rep = reps.find((r) => r.id === repId)!;
  const byDay = new Map<string, typeof data.sessions>();
  for (const s of data.sessions) {
    const k = dateKeyInTz(s.start, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const now = new Date();

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Rep activity" subtitle="When each rep signs in, opens the app, and what they look at. Reps are told on their account page that this is recorded." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reps.map((r) => {
          const seen = lastSeen.get(r.id);
          return (
            <Link key={r.id} href={`/activity?${new URLSearchParams({ rep: r.id, range: range.preset, ...(range.preset === "custom" ? { from: range.startKey, to: range.endKey } : {}) })}`} className={`card block px-4 py-3 hover:border-gray-300 ${r.id === repId ? "ring-2 ring-accent/40" : ""}`}>
              <div className="flex items-center gap-2 font-medium">{r.name}{!r.active && <Badge tone="muted">Deactivated</Badge>}</div>
              <div className="text-sm text-muted">{seen ? <>Last active {relativeDay(seen, tz, now)} at {fmtTime(seen, tz)}</> : "Hasn't used the app yet"}</div>
            </Link>
          );
        })}
      </div>
      <RangePicker range={range} basePath="/activity" extra={{ rep: repId }} allowAll />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="neutral">{data.totals.sessions} time(s) opened the app</Badge>
        <Badge tone="good">{data.totals.signIns} sign-in(s)</Badge>
        <Badge tone="neutral">{data.totals.pages} page(s) viewed</Badge>
        {data.totals.failed > 0 && <Badge tone="bad">{data.totals.failed} failed sign-in(s)</Badge>}
      </div>
      {byDay.size === 0 ? (
        <div className="card"><Empty>No activity for {rep.name} in {range.label.toLowerCase()}.</Empty></div>
      ) : (
        [...byDay.entries()].map(([day, sessions]) => (
          <Section key={day} title={fmtDate(sessions[0].start, tz, { weekday: "long", month: "short", day: "numeric", year: "numeric" })} subtitle={`${sessions.length} time(s) in the app`}>
            <ul className="divide-y divide-line">
              {sessions.map((s, i) => (
                <li key={i} className="px-4 py-3">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <span className="font-medium">{fmtTime(s.start, tz)}</span>
                      <span className="text-muted"> – {fmtTime(s.end, tz)} · {duration(s.end.getTime() - s.start.getTime())} · {s.pages} page(s){s.device ? ` · ${s.device}` : ""}</span>
                      {s.events.some((e) => e.kind === "login") && <Badge tone="good" className="ml-2">Signed in</Badge>}
                      {s.events.some((e) => e.kind === "failed") && <Badge tone="bad" className="ml-2">Failed sign-in</Badge>}
                      <span className="ml-2 text-xs text-accent">Show what they did</span>
                    </summary>
                    <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-sm">
                      {s.events.map((e, j) => (
                        <li key={j} className="flex flex-wrap items-baseline gap-2">
                          <span className="w-16 shrink-0 tabular-nums text-xs text-muted">{fmtTime(e.at, tz)}</span>
                          <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
                          {e.href ? <Link className="link" href={e.href}>{e.text}</Link> : <span>{e.text}</span>}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
      <p className="text-xs text-muted">A sign-in, or coming back after 30+ minutes away, counts as opening the app (reps stay signed in for up to 14 days). Page views are kept for a year. Times are {tz.replace("_", " ")}. Last checked {fmtDateTime(now, tz)}.</p>
    </div>
  );
}
