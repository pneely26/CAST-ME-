import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { OpportunityCard } from "@/components/OpportunityCard";
import { Badge, ClassificationBadge, DeadlineBadge, DemoBadge, Empty, PageHeader, ReviewBadge, Section, Stat } from "@/components/ui";
import { HBarChart } from "@/components/Charts";
import { breakdownInclude, castingDirectorActivity } from "@/lib/server/queries";
import { getWatchlistActivity } from "@/lib/server/watchlist";
import { BLIND_SPOT_EXPLANATION, REGION_LABELS, type RegionCode } from "@/lib/constants";
import { fmtDate, relativeDays } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const now = new Date();
  const openWhere = { visibility: { not: "CLOSED" as const }, OR: [{ submissionDeadline: null }, { submissionDeadline: { gte: now } }] };
  const [recent, deadlines, spots, openCount, highCount, spotCount, unread, activity, cdActivity, webNew] = await Promise.all([
    prisma.publicBreakdown.findMany({ where: openWhere, include: breakdownInclude, orderBy: [{ importedAt: "desc" }], take: 6 }),
    prisma.publicBreakdown.findMany({
      where: { visibility: { not: "CLOSED" }, submissionDeadline: { gte: new Date(now.getTime() - 86_400_000) } },
      include: { project: true },
      orderBy: { submissionDeadline: "asc" },
      take: 8,
    }),
    prisma.blindSpot.findMany({
      where: { classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: { in: ["UNREVIEWED", "CONFIRMED_NOT_FOUND"] } },
      include: { project: { include: { castings: { include: { castingDirector: true } } } }, agencySubmission: true },
      orderBy: { detectionDate: "desc" },
      take: 8,
    }),
    prisma.publicBreakdown.count({ where: openWhere }),
    prisma.publicBreakdown.count({ where: { ...openWhere, relevance: "HIGH" } }),
    prisma.blindSpot.count({ where: { classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] }, reviewStatus: "UNREVIEWED" } }),
    prisma.alert.count({ where: { readAt: null } }),
    getWatchlistActivity(30, now),
    castingDirectorActivity(90, 8),
    prisma.webFinding.count({ where: { status: "NEW" } }),
  ]);
  const weekDeadlines = deadlines.filter((d) => d.submissionDeadline && d.submissionDeadline.getTime() - now.getTime() < 7 * 86_400_000).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Public opportunities, agency-reported submissions, and potential blind spots — based only on public, user-provided, or manually entered data."
        actions={
          <>
            <Link href="/imports" className="btn-secondary">Import data</Link>
            <Link href="/submissions/new" className="btn-primary">Add agency submission</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open opportunities" value={openCount} href="/opportunities" />
        <Stat label="High relevance" value={highCount} href="/opportunities?relevance=HIGH" tone="accent" />
        <Stat label="Blind spots to review" value={spotCount} href="/blind-spots" tone="signal" />
        <Stat label="Deadlines this week" value={weekDeadlines} href="/opportunities?sort=deadline" />
        <Stat label="New web findings" value={webNew} href="/web-monitor" tone="accent" />
        <Stat label="Unread alerts" value={unread} href="/alerts" />
      </div>

      <Section title="New opportunities" subtitle="Recently discovered public listings" action={<Link href="/opportunities" className="link text-sm">View all</Link>}>
        {recent.length === 0 ? (
          <Empty>No public opportunities yet. <Link href="/imports" className="link">Import a file</Link> or <Link href="/opportunities/new" className="link">add one manually</Link>.</Empty>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {recent.map((b) => <OpportunityCard key={b.id} b={b} now={now} />)}
          </div>
        )}
      </Section>

      <Section title="Potential blind spots" subtitle={BLIND_SPOT_EXPLANATION} action={<Link href="/blind-spots" className="link text-sm">Review all</Link>}>
        {spots.length === 0 ? (
          <Empty>No potential blind spots. Agency submissions are compared against the public dataset automatically.</Empty>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table-base">
                <thead>
                  <tr><th>Project</th><th>Submitted</th><th>Casting director</th><th>Platform</th><th>Region</th><th>Why it was flagged</th><th>Review</th></tr>
                </thead>
                <tbody>
                  {spots.map((s) => (
                    <tr key={s.id} className="hover:bg-paper/60">
                      <td><Link href={`/blind-spots/${s.id}`} className="font-medium link">{s.project.title}</Link> <DemoBadge show={s.project.isDemo} /></td>
                      <td className="whitespace-nowrap">{fmtDate(s.agencySubmission?.dateSubmitted)}</td>
                      <td>{s.agencySubmission?.castingDirectorRaw ?? s.project.castings.map((c) => c.castingDirector.name).join(", ") ?? "—"}</td>
                      <td>{s.agencySubmission?.platform ?? s.project.platform ?? "—"}</td>
                      <td>{regionLabel(s.agencySubmission?.region ?? s.project.region)}</td>
                      <td className="max-w-xs text-ink-soft"><ClassificationBadge value={s.classification} /><div className="mt-1 text-xs">{s.classification === "NEEDS_REVIEW" ? "Possible public match — uncertain; needs review." : BLIND_SPOT_EXPLANATION}</div></td>
                      <td><ReviewBadge value={s.reviewStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {spots.map((s) => (
                <li key={s.id} className="p-4">
                  <Link href={`/blind-spots/${s.id}`} className="font-medium link">{s.project.title}</Link>
                  <div className="mt-1 text-xs text-muted">Submitted {fmtDate(s.agencySubmission?.dateSubmitted)} · {s.agencySubmission?.castingDirectorRaw ?? "CD not listed"} · {s.agencySubmission?.platform ?? "—"} · {regionLabel(s.agencySubmission?.region)}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><ClassificationBadge value={s.classification} /><ReviewBadge value={s.reviewStatus} /><DemoBadge show={s.project.isDemo} /></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Upcoming deadlines" subtitle="Nearest first" action={<Link href="/opportunities?sort=deadline" className="link text-sm">All</Link>}>
          {deadlines.length === 0 ? (
            <Empty>No upcoming deadlines.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {deadlines.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/opportunities/${b.id}`} className="block truncate text-sm font-medium hover:underline">{b.project.title}</Link>
                    <div className="truncate text-xs text-muted">{b.roleName ?? "Role not listed"} · {fmtDate(b.submissionDeadline)}</div>
                  </div>
                  <DeadlineBadge deadline={b.submissionDeadline} now={now} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Watchlist activity" subtitle="Last 30 days" action={<Link href="/watchlist" className="link text-sm">Watchlist</Link>}>
          {activity.length === 0 ? (
            <Empty>No recent activity for watched items. <Link href="/watchlist" className="link">Add something to watch</Link>.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {activity.slice(0, 8).map((a) => (
                <li key={a.watchId + a.key} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={a.kind === "AGENCY_SUBMISSION" ? "signal" : "accent"}>{a.watchLabel}</Badge>
                    <span className="text-xs text-muted">{relativeDays(a.date, now)}</span>
                  </div>
                  <Link href={a.link} className="mt-1 block truncate text-sm hover:underline">{a.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Casting director activity" subtitle="Casting directors appearing most frequently in projects on file (last 90 days). Frequency only — not a ranking.">
        <div className="grid gap-4 p-3 lg:grid-cols-2">
          <HBarChart data={cdActivity.map((c) => ({ name: c.name, value: c.count }))} />
          <ul className="divide-y divide-line text-sm">
            {cdActivity.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/casting-directors/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  <div className="truncate text-xs text-muted">{[c.office, c.city && `based in ${c.city}`].filter(Boolean).join(" · ") || "Office not listed"}</div>
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted">{c.count} project{c.count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </div>
  );
}

function regionLabel(r: string | null | undefined) {
  return r ? REGION_LABELS[r as RegionCode] : "—";
}
