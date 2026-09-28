import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { addWatchAction, toggleWatchAction } from "@/app/actions/watchlist";
import { getWatchlistActivity, watchLabel } from "@/lib/server/watchlist";
import { getPlatforms } from "@/lib/server/profile";
import { Badge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { REGIONS, REGION_LABELS, WATCH_TYPES, humanize } from "@/lib/constants";
import { relativeDays, fmtDate } from "@/lib/format";
import type { SP } from "@/lib/server/filters";
import { str } from "@/lib/server/filters";

export const metadata = { title: "Watchlist" };

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const [items, activity, cds, projects, platforms, offices] = await Promise.all([
    prisma.watchlistItem.findMany({ orderBy: [{ type: "asc" }, { value: "asc" }], include: { castingDirector: true, project: true } }),
    getWatchlistActivity(60, now),
    prisma.castingDirector.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
    getPlatforms(),
    prisma.castingDirector.findMany({ where: { castingOffice: { not: null } }, select: { castingOffice: true }, distinct: ["castingOffice"] }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Watchlist" description="Watch casting directors, casting offices, platforms, projects and regions. New matching activity appears here, on the dashboard, and as alerts." />
      <Flash message={str(sp, "msg")} />
      <Flash message={str(sp, "error")} tone="bad" />
      <Section title="Add watchlist item">
        <form action={addWatchAction} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">Type</span>
            <select name="type" className="input" defaultValue="CASTING_DIRECTOR">
              {WATCH_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Casting director</span>
            <select name="castingDirectorId" className="input"><option value="">—</option>{cds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="block"><span className="label">Project</span>
            <select name="projectId" className="input"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
          </label>
          <label className="block"><span className="label">Region</span>
            <select name="region" className="input"><option value="">—</option>{REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}</select>
          </label>
          <label className="block"><span className="label">Platform</span>
            <select name="platform" className="input"><option value="">—</option>{platforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
          <label className="block"><span className="label">Casting office / other value</span>
            <input name="value" list="offices" className="input" placeholder="e.g. Bell & Harlow Casting" />
            <datalist id="offices">{offices.map((o) => <option key={o.castingOffice} value={o.castingOffice ?? ""} />)}</datalist>
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-2">
            <p className="mr-3 text-xs text-muted">Pick a type, then fill the matching field.</p>
            <button className="btn-primary">Watch</button>
          </div>
        </form>
      </Section>

      <div className="grid gap-5 lg:grid-cols-5">
        <Section title="Watching" className="lg:col-span-2">
          {items.length === 0 ? <Empty>Nothing on your watchlist yet.</Empty> : (
            <ul className="divide-y divide-line">
              {items.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Badge tone="accent">{humanize(w.type)}</Badge>{" "}
                    {w.castingDirectorId ? <Link href={`/casting-directors/${w.castingDirectorId}`} className="text-sm font-medium hover:underline">{w.value}</Link>
                      : w.projectId ? <Link href={`/projects/${w.projectId}`} className="text-sm font-medium hover:underline">{w.value}</Link>
                      : <span className="text-sm font-medium">{w.type === "REGION" ? REGION_LABELS[w.value as keyof typeof REGION_LABELS] ?? w.value : w.value}</span>}
                    <div className="text-xs text-muted">since {fmtDate(w.createdAt)} · {activity.filter((a) => a.watchId === w.id).length} recent item(s)</div>
                  </div>
                  <form action={toggleWatchAction}>
                    <input type="hidden" name="watchId" value={w.id} /><input type="hidden" name="back" value="/watchlist" />
                    <button className="btn-secondary text-xs">Unwatch</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Activity" subtitle="Last 60 days" className="lg:col-span-3">
          {activity.length === 0 ? <Empty>No activity yet for watched items.</Empty> : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.watchId + a.key} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={a.kind === "AGENCY_SUBMISSION" ? "signal" : "accent"}>{watchLabel(items.find((i) => i.id === a.watchId) ?? { type: "PROJECT", value: a.watchLabel })}</Badge>
                    <span className="text-xs text-muted">{relativeDays(a.date, now)}</span>
                  </div>
                  <Link href={a.link} className="mt-1 block text-sm hover:underline">{a.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
