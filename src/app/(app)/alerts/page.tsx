import Link from "next/link";
import type { AlertType } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { markAlertReadAction, markAllReadAction, runMonitorAction } from "@/app/actions/alerts";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { humanize } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Alerts" };
const TYPES: AlertType[] = ["NEW_MATCH", "WATCHLIST_ACTIVITY", "POTENTIAL_BLIND_SPOT", "DEADLINE_APPROACHING", "REPEAT_CASTING_DIRECTOR"];
const TONE: Record<AlertType, "good" | "accent" | "signal" | "bad" | "neutral"> = {
  NEW_MATCH: "good", WATCHLIST_ACTIVITY: "accent", POTENTIAL_BLIND_SPOT: "signal", DEADLINE_APPROACHING: "bad", REPEAT_CASTING_DIRECTOR: "neutral",
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const type = str(sp, "type") as AlertType | undefined;
  const alerts = await prisma.alert.findMany({ where: type && TYPES.includes(type) ? { type } : {}, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 300 });
  return (
    <div>
      <PageHeader
        title="Alerts"
        description="In-app notifications. Email delivery can be enabled later (see README)."
        actions={<><form action={runMonitorAction}><button className="btn-secondary">Run checks now</button></form><form action={markAllReadAction}><button className="btn-secondary">Mark all read</button></form></>}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/alerts" className={!type ? "btn-primary" : "btn-secondary"}>All</Link>
        {TYPES.map((t) => <Link key={t} href={`/alerts?type=${t}`} className={type === t ? "btn-primary" : "btn-secondary"}>{humanize(t)}</Link>)}
      </div>
      <Section title={`${alerts.length} alert(s)`}>
        {alerts.length === 0 ? <Empty>No alerts.</Empty> : (
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li key={a.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${a.readAt ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[a.type]}>{humanize(a.type)}</Badge>{!a.readAt && <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="unread" />}<span className="text-xs text-muted">{fmtDateTime(a.createdAt)}</span></div>
                  {a.link ? <Link href={a.link} className="mt-1 block font-medium hover:underline">{a.title}</Link> : <div className="mt-1 font-medium">{a.title}</div>}
                  <div className="text-sm text-ink-soft">{a.body}</div>
                </div>
                {!a.readAt && <form action={markAlertReadAction}><input type="hidden" name="id" value={a.id} /><button className="btn-ghost text-xs">Mark read</button></form>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
