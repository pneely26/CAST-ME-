import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { Badge, DemoBadge, Empty, PageHeader } from "@/components/ui";
import { FilterBar, Select, TextFilter, regionOptions } from "@/components/Filters";
import { WatchButton } from "@/components/WatchButton";
import { region, str, type SP } from "@/lib/server/filters";
import { relativeDays } from "@/lib/format";

export const metadata = { title: "Casting Directors" };

export default async function CDsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = str(sp, "q");
  const r = region(sp);
  const watched = str(sp, "watched");
  const and: Prisma.CastingDirectorWhereInput[] = [];
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { castingOffice: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] });
  if (r) and.push({ castings: { some: { project: { OR: [{ region: r }, { breakdowns: { some: { region: r } } }] } } } });
  if (watched === "yes") and.push({ watchItems: { some: {} } });
  const cds = await prisma.castingDirector.findMany({
    where: { AND: and },
    include: {
      watchItems: true,
      castings: { include: { project: { select: { id: true, agencyReported: true, updatedAt: true, _count: { select: { breakdowns: true, submissions: true } } } } } },
    },
    orderBy: { name: "asc" },
  });
  const now = new Date();
  return (
    <div>
      <PageHeader
        title="Casting Directors"
        description="Search casting directors and offices. Counts show activity frequency in your data — not a ranking."
        actions={<Link href={`/casting-directors/new${q ? `?name=${encodeURIComponent(q)}` : ""}`} className="btn-primary">New casting director</Link>}
      />
      <FilterBar resetHref="/casting-directors">
        <TextFilter name="q" label="Search" value={q} placeholder="Name, office, city" />
        <Select name="region" label="Project region" value={r} options={regionOptions} />
        <Select name="watched" label="Watchlist" value={watched} any="All" options={[{ value: "yes", label: "Watched only" }]} />
      </FilterBar>
      <div className="card overflow-hidden">
        {cds.length === 0 ? (
          <Empty>No casting directors found{q ? <> for “{q}”. <Link className="link" href={`/casting-directors/new?name=${encodeURIComponent(q)}`}>Add “{q}”</Link></> : "."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {cds.map((cd) => {
              const w = cd.watchItems.find((x) => x.type === "CASTING_DIRECTOR");
              const pub = cd.castings.filter((c) => c.project._count.breakdowns > 0).length;
              const ag = cd.castings.filter((c) => c.project._count.submissions > 0).length;
              const last = cd.castings.map((c) => c.project.updatedAt).sort((a, b) => b.getTime() - a.getTime())[0];
              return (
                <li key={cd.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/casting-directors/${cd.id}`} className="font-medium hover:underline">{cd.name}</Link>
                      {w && <Badge tone="accent">Watching</Badge>}
                      <DemoBadge show={cd.isDemo} />
                    </div>
                    <div className="text-xs text-muted">
                      {[cd.castingOffice, (cd.city || cd.state) && `based in ${[cd.city, cd.state].filter(Boolean).join(", ")}`].filter(Boolean).join(" · ") || "Office/location not listed"}
                    </div>
                    <div className="mt-1 text-xs text-ink-soft">
                      {cd.castings.length} project(s) · {pub} with public breakdowns · {ag} agency-reported · last activity {last ? relativeDays(last, now) : "—"}
                    </div>
                  </div>
                  <WatchButton type="CASTING_DIRECTOR" value={cd.name} castingDirectorId={cd.id} watchId={w?.id} back={`/casting-directors${q ? `?q=${encodeURIComponent(q)}` : ""}`} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
